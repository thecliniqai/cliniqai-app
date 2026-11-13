---
phase: 04
plan: 04-04
subsystem: jobs/alerts (rules, evaluator, alert.notify, readiness job flags)
status: complete
requirements: [P1-25 (alerts part)]
plan_head_before: d159dc481c63b9f60be327f1df24114df0661c4b
---

# 04-04 record: alerts (dead letter, lag, stale runner, lease expiry, error burst, error-sink overflow/size, stale backups)

**Outcome:** done locally. pg_cron evaluates nine alert rules every 5 minutes in pure SQL; a firing rule opens one
alert and one `alert.notify` job; the job runner emails the ops inbox once per notification through the existing
`EmailSender` (Mailpit locally, Resend/SES on staging/production); a persistent condition re-sends only after the
rule's cooldown; two clean evaluations resolve. The local alert drill (`drill.always_fail` → dead → `dead_letter` →
`alert.notify` → one Mailpit message) runs in CI. `/api/ready` gained four job flags, booleans only. Nothing contacted
a hosted Supabase project, Vercel, Resend, SES or GitHub settings; no `--linked`, no `db push`, no `.env*` read, no
dependency added. Base `d159dc4`.

## What shipped

| Commit | Content |
|---|---|
| `8078e3e` | Migration **`000039_ops_alerts.sql`** (plan: 000038; 000037/000038 went to 04-03c), `EXPECTED_MIGRATION = "000039"`, `scripts/drift/schema-snapshot.txt` regenerated after `db reset --local`, `types/database.ts` (`npm run db:types`); `lib/jobs/internal/handlers/alert-notify.ts` (+ `renderAlertEmail`), `drill.always_fail` in `handlers/drill.ts`, `alert.notify` in the registry; `EmailTag` `"ops-alert"`; `/api/ready` `jobs` block; `OPS_ALERT_EMAIL` (R-15 checklist: `shapeSchema`, `Env`, production rule, `ENV_DOCS`, `.env.example` regenerated, `environment.txt.example`, lane pin, e2e value, `env-schema`/`env-boot`/`test-env-guard` specs); `tests/jobs/alert-helpers.ts`; tracer `tests/jobs/alert-drill-db.spec.ts` |
| `f2b1699` | `tests/jobs/{alerts-db,alert-notify-db,alert-email}.spec.ts`; `tests/api/{readiness-probe-db,health-probes}.spec.ts` extended |
| `df147cd` | `docs/runbooks/jobs.md` §12 (architecture, channel, noise control, rules table, one response section per rule with the anchor the email links, local and staging alert drill, readiness flags) |
| `7f8cdcd` | `tests/security/guard-manifest.ts` (`/api/ready` key allowlist + `jobs`); `alerts-db` lifecycle case compares same-transaction rows as sets (found by full-lane run 1) |
| `9892d71` | `tests/e2e/jobs/run-route.spec.ts` parks other due non-drill jobs (the route now claims `alert.notify`) |

### Migration 000039

- `ops.alert_rules(rule pk, severity critical|warn|info, fn text ^ops\.alert_rule_…, enabled, cooldown_minutes 5..10080,
  params jsonb ≤ 1 KB, description)` with nine rows; `ops.alerts(id, rule fk, severity, status open|resolved,
  first_seen, last_seen, count, details jsonb ≤ 4 KB, clean_evaluations, notified_at, notify_count,
  provider_message_id ≤ 200, resolved_at)`, unique open per rule, partial index on open severity, index on
  `last_seen`. RLS on, no policy, every privilege revoked from `anon`, `authenticated`, `service_role`.
- Rule functions `ops.alert_rule_<rule>(p_params jsonb) returns table(firing, details)`: definer, `search_path = ''`,
  STABLE, postgres only. Details: counts, parameters, ISO timestamps, ≤ 10 job ids.

| Rule | Severity | Fires when (defaults) | Cooldown |
|---|---|---|---|
| `dead_letter` | warn | job `dead` (kind ≠ `alert.notify`, R-36), message `dead_letter` or webhook `failed`, last 15 min | 60 min |
| `queue_lag` | warn | p95(`first_claimed_at − run_at`) over jobs first claimed in 15 min > 120 s, ≥ 5 samples | 60 min |
| `queue_oldest_due` | critical | a `pending` job due > 5 min | 60 min |
| `runner_stale` | critical | Vault `jobs_runner_url` exists and no `ok` runner pass started in 5 min | 60 min |
| `lease_expiry` | warn | > 3 `last_lease_expired_at` in 15 min | 60 min |
| `error_burst` | warn | `sum(count)` of `ops.error_events` with `last_seen` in 10 min > 20 | 60 min |
| `error_sink_overflow` | warn | `ops.error_event_overflow` `dropped > 0` today or yesterday (UTC) | 6 h |
| `error_sink_size` | warn | `ops.error_events_size()` bytes > 50 000 000 | 24 h |
| `backup_stale` | critical | `ops.backup_runs` has rows and none `ok` in 13 h, **or the latest run failed** (D5) | 3 h |

- **Amended in place after the orchestrator's rulings (000039 was never pushed or applied elsewhere, so no 000040):**
  `ops.alerts` gained `notify_seq_enqueued`, `notify_tries`, `notify_enqueued_at`, `notify_job_id` and the evaluator the
  R-51 retry below; snapshot regenerated after `db reset --local` (types unchanged: `ops` only).
- `ops.evaluate_alerts() returns int` (number of firing rules): advisory xact lock; per enabled rule (function resolved
  with `to_regprocedure(fn || '(jsonb)')`, run in its own exception block so one broken rule never stops the others);
  firing → refresh the open alert (`count + 1`, `last_seen`, `details`, `clean_evaluations = 0`) or open one; a new
  alert or `notified_at` older than the cooldown → `ops.enqueue_job('alert.notify', null, {alert_id, seq},
  'alert:<id>:<seq>', now(), 5)` with `seq = notify_count + 1`; not firing → `clean_evaluations + 1`, resolved at 2.
  **R-51 (at-least-once):** for any open alert, a notification enqueued but not recorded as sent is enqueued again
  (`alert:<id>:<seq>:r<try>`, same `seq`) once its last try is 15+ minutes old and no try is pending or running.
  Cron `ops-evaluate-alerts` `*/5 * * * *`.
- `public.ops_alert_payload(uuid) → jsonb` and `public.ops_alert_notified(uuid, text, int) → boolean` (service role
  only; the second sets `notified_at`, `notify_count = seq` and an id-shaped provider id only when `notify_count < seq`).
- `readiness_probe(p_expected_migration)` replaced in place (same signature, definer, `search_path = ''`, EXECUTE for
  `anon` only): every V2-03 key plus `jobs_backlog`, `jobs_dead_24h`, `runner_stale`, `alerts_critical_open`, each an
  indexed `EXISTS`. New indexes `jobs_first_claimed_at`, `jobs_last_lease_expired_at` (partial).

### App

- `alert.notify` (`{alert_id, seq}`, `maxDurationMs` 10 000): no `OPS_ALERT_EMAIL` or `EMAIL_PROVIDER=disabled` (or
  `EmailDisabledError`/a config error) → dead `alert_channel_unconfigured`; payload missing → dead `alert_not_found`;
  `notify_count ≥ seq` → done without a send; `getEmailSender().send({to, subject "[clinicos <APP_ENV>] <SEVERITY>
  <rule>", text, html, tag "ops-alert"}, {signal, idempotencyKey "ops-alert/<id>/<seq>"})`; `EmailSendError` → retry
  with its fixed code (`safeCode`); then `ops_alert_notified`. No log lines of its own (the runner logs counts).
- `renderAlertEmail`: environment, rule, severity, status, alert id, first/last seen in IST and UTC, evaluations firing,
  notification number, detail lines, runbook anchor `docs/runbooks/jobs.md#<rule>`. A detail is printed only when its key
  is a lower-case word and its value a finite number, boolean, null, ISO timestamp, UUID or a list (≤ 10) of those;
  everything else is counted in `omitted: n`. All cells HTML-escaped.
- `/api/ready`: `jobs: { backlog, dead24h, runnerStale, alertsCriticalOpen }`; the four keys must be booleans, all
  present or all absent (a database behind 000039 → `jobs: null`, `schema: behind`); status codes unchanged.
- `OPS_ALERT_EMAIL`: email shape in every tier, required in production, optional elsewhere; test lanes allow only
  `ops-alerts@example.test` (`LOCAL_OPS_ALERT_EMAIL`), the e2e server runs with it, Vitest leaves it unset.

## Tests that fail without the change

`evidence/04-04/before-vitest.txt`: the new and changed specs on pre-plan `d159dc4` (throwaway worktree, stack reset to
000038; the copied files are listed in its header): **7 of 9 files fail, 42 tests**. The two passing files are
`env-boot.spec.ts` (only its production profile gained the key) and `test-env-guard.spec.ts`, whose subject
(`tests/setup/test-env.ts`) had to be copied in with it.

| Spec | Proves |
|---|---|
| `tests/jobs/alert-drill-db.spec.ts` (tracer, 1) | `ops.drill_enqueue('drill.always_fail', 1, '0', 2)` → two passes with the real registry (`pending`/`drill_failure`, then `dead`, attempts 2) → evaluate → one open `dead_letter` naming the job id, one job `alert:<id>:1` → runner → **exactly one Mailpit message** (subject `[clinicos test] WARN dead_letter`, to the ops inbox, tag `ops-alert`, alert id, job id, runbook anchor) → alert `notify_count 1`, provider id = Mailpit id; a second evaluation → `count 2`, no new job, still one message |
| R-51 additions | `alerts-db` (+1): a pending try is never doubled; a dead try < 15 min → nothing, ≥ 15 min → one `alert:<id>:1:r2` (also while the alert is clearing); once sent, nothing; a failed `seq 2` is retried as `seq 2`. `alert-notify-db` (+1): **provider down (5 failed tries, job dead) → no email, `notified_at` null → inside 15 min nothing → provider back → the next evaluation enqueues one retry → exactly one email, alert notified → later evaluations send nothing.** Without the change it fails (`evidence/04-04/negative-r51-no-retry.txt`: the pre-ruling evaluator body on the stack, no `:r2` job) |
| `tests/jobs/alerts-db.spec.ts` (33, rolled-back sessions from an emptied baseline) | quiet baseline: no alert, no job; the nine rules and severities; **each rule fires on its synthetic condition and stays quiet just below it**: dead job / dead-lettered message / failed webhook vs 16 min old; p95 150 s over 5 samples vs 4 samples, p95 under 120 s, 119 s; due 6 min vs 4 min; Vault URL with no pass, a failed pass, a 6-min-old pass vs a recent ok pass and no Vault secret; 4 vs 3 lease expiries and 4 outside the window; 21 errors (one or two fingerprints) vs 20 and 11 min old; overflow today 3 / yesterday vs 2 days ago and 0; size with the parameter lowered vs the default; 14-h-old ok / a failed latest run (with or without an earlier ok) vs no rows, a 2-h ok, a failure followed by an ok; **persistent condition inside the cooldown → count 2, one job**; expired cooldown → `seq 2`; inside the cooldown or never notified → no new job; two clean evaluations resolve, firing again opens a new alert with `seq 1`; a dead `alert.notify` → nothing (R-36); a broken rule parameter and a disabled rule do not stop the others; with all nine firing, details are only numbers, booleans, null, ISO timestamps and UUID lists; grants (no API role on the evaluator/rules/tables; handler RPCs service role only, no PUBLIC), definer + empty `search_path` for all 12 functions, PostgREST refuses anon (42501), `ops_alert_notified` idempotent per seq and drops a free-text provider id, cron row once as `postgres` |
| `tests/jobs/alert-notify-db.spec.ts` (9, Mailpit) | one message per notification with the expected subject and IST/UTC lines, recorded on the alert, job done after 1 attempt; CRITICAL subject; **a synthetic patient's dead-lettered message raises `dead_letter` and the email holds none of the patient's phone (both forms), name, guardian name/phone, the owner's email or clinic name, or the tenant/patient/visit/queue ids**; **every input of `tests/fixtures/scrub-vectors.json` put into the details as values and keys (in 4 KB batches) leaves none of its `absent` strings**; `OPS_ALERT_EMAIL` unset and `EMAIL_PROVIDER=disabled` → dead `alert_channel_unconfigured`, no message, alert unnotified; unreachable Mailpit → retried with `mailpit_unreachable`; already notified → done, no send; unknown alert → dead `alert_not_found` |
| `tests/jobs/alert-email.spec.ts` (50, unit) | exact text layout incl. IST conversion and the anchor; HTML escaping (only the renderer's own tags appear); the detail filter (8 kept, 9 omitted incl. phone strings, a rule-like word, objects, an 11-item list, Infinity, bad keys); each of the 46 scrub vectors; 20-key cap |
| `tests/api/readiness-probe-db.spec.ts` (+1, changed 2) | the eight flags are present and boolean; each job check is index-only with seq scans off; seeded (rolled back): dead job → `jobs_dead_24h` (25 h old → false), 6-min due job → `jobs_backlog` (4 min → false), Vault URL without a pass → `runner_stale` (recent ok pass → false), open critical alert → `alerts_critical_open` (warn → false); no number in any value; the anon definer allowlist is unchanged |
| `tests/api/health-probes.spec.ts` (+1, changed 3) | `jobs` block with the four booleans; non-boolean or partial job flags → 503 with `jobs: null`; behind-schema answer → `jobs: null`, `schema: behind`; RPC failure → `jobs: null` |
| `tests/config/env-schema.spec.ts` (+2), `env-boot.spec.ts` (profile), `tests/setup/test-env-guard.spec.ts` (+1) | production without / blank / malformed (4 shapes) `OPS_ALERT_EMAIL` throws naming the key and never the value; staging and CI may leave it unset; the e2e server uses the synthetic inbox; the lane guard accepts only `ops-alerts@example.test` and never echoes another value |
| `tests/security/guard-routes.spec.ts` (manifest) | `/api/ready`'s public-health leg allows the new `jobs` key and nothing else |

Determinism: no sleeps; time moves by SQL; `alerts-db` runs only inside `begin … rollback`; the committing specs start
from and leave an empty `ops.alerts` and no `alert.notify`/`drill.always_fail` jobs; Mailpit messages are found by
alert id and deleted afterwards. Run 1 found one tie-order dependency in my own lifecycle case (two rows of one
transaction share `now()`): fixed in `7f8cdcd` by comparing as sets; three isolated reruns and run 2 green.

## Gates (tool output in `evidence/04-04/`)

- `npm run typecheck` clean; `npx eslint .` 0 errors (382 warnings, pre-existing kinds); `npm run inventory` exit 0;
  `node scripts/ci/env-example.mjs --check` in sync; schema snapshot `--check` PASS (2 422 lines); `npm run
  db:drift:local` PASS (0 statements, 0 allowlisted).
- Full Vitest lane run 1 (`vitest-full-run1.txt`, at `df147cd`): 195 files, 4 089 passed, **2 failed** (the tie-order
  case above and the guard manifest's `/api/ready` key allowlist, which I had not updated). Run 2 (`vitest-full-run2.txt`,
  at `9892d71`): **195 files, 4 091 passed, 0 failed**; teardown verified; `cron.job` 5/5 active afterwards; no
  `ops.alerts` rows or `alert.notify`/`drill.always_fail` jobs left; no `.planning/dev-messages.txt`.
- After rulings R-50/R-51 (`c1d4096`, 000039 amended): full Vitest lane run 3 (`vitest-full-run3.txt`): **195 files,
  4 093 passed, 0 failed**; `cron.job` 5/5 active; no alert residue; snapshot `--check` and `db:drift:local` PASS.
- `e2e-build.txt`: output scan clean (1 315 files). `e2e-pr.txt` (desktop, Pixel 7, iPhone 15): **196 passed, 9
  skipped, 0 failed, 0 flaky, 0 retried**; the 10 `✘` lines are the same `knownBug` expected failures as 04-03c's run.
- gitleaks 8.30.1 (docker, `--network none`) over the full history after the code commits: no leaks found (637
  commits); re-run after the docs commit in the hand-back.

## Deviations

| # | Plan said | Done | Why |
|---|---|---|---|
| D1 | migration `000038_ops_alerts` | `000039_ops_alerts` | next free number (R-39); 04-06 takes 000040 |
| D2 | `ops.alert_rules.fn regprocedure` | `fn text` (CHECK `^ops\.alert_rule_…`), resolved with `to_regprocedure` at evaluation | pg_upgrade refuses user tables with `regprocedure` columns, and Supabase major-version upgrades use pg_upgrade; text + a name check keeps the same closed set |
| D3 | rule parameters "lowered in a rolled-back transaction" | `params jsonb` (+ `description`) on `ops.alert_rules`; each rule reads its thresholds from it | the plan's size test needs a parameter; one place to tune thresholds by migration |
| D4 | payload `{alert_id}`, `ops_alert_notified(p_alert_id, p_provider_message_id)` | payload `{alert_id, seq}`, `ops_alert_notified(…, p_seq)`; the handler skips when `notify_count ≥ seq` | exactly once per notification: a retried job cannot bump the count twice or re-send after a recorded send; the email idempotency key is per `(alert, seq)` (Resend dedupes a retry after a lost `notified` write; Mailpit/SES may repeat in that one case, documented) |
| D5 | `backup_stale`: rows exist and none `ok` in 13 h | also fires when the latest run failed | the roadmap's "a deliberately failed run raises an alert"; the GitHub issue path (04-05a) stays the independent channel. **Accepted by the orchestrator as ruling R-50** |
| D6 | `runner_stale`: no `ok` run in 5 min | keyed on `started_at` (indexed) of an `ok` pass | a pass lasts ≤ 25 s; `coalesce(finished_at, started_at)` cannot use the index (probe must stay index-only) |
| D7 | evaluate: "when newly opened or `notified_at` older than the cooldown" | ~~a never-sent alert is not re-enqueued~~ **reversed by ruling R-51**: re-enqueued every 15 min (no try in flight) until recorded as sent; one email per successful notification (`seq` + handler skip + idempotency key) | orchestrator: at-least-once delivery for alerts; the 15-minute floor keeps R-36's flood protection |
| D8 | — | queue_lag skips rows whose `run_at` moved past their first claim | a retry rewrites `run_at`; such rows would give negative lag |
| D9 | — | advisory lock; per-rule exception block with `RAISE WARNING` (rule name + SQLSTATE); returns the number of firing rules | concurrent cron/manual calls cannot double-open; one bad parameter cannot silence every alert |
| D10 | "details … rule names" allowed in the email | detail values limited to numbers, booleans, null, ISO timestamps, UUIDs (rule names only in the header) | a lower-case word could be a name; stricter than planned |
| D11 | `/api/ready` "accepts the new keys only as booleans" | and all four or none (`jobs: null` for a database behind 000039) | keeps "schema behind" diagnosable instead of "database error" |
| D12 | guard manifest in the file list | only the `/api/ready` key allowlist changed (no new route or action) | — |
| D13 | — (not in the file list; Rule 1/3 caused by the new kind) | `tests/e2e/jobs/run-route.spec.ts` parks other due non-drill jobs | the e2e route claims every kind; between lanes the local stack's cron now evaluates alerts and can leave due `alert.notify` jobs, which would have made its `done: 1` count order-dependent |
| D14 | — | `environment.txt.example` gained the `OPS_ALERT_EMAIL` lines | the PO's single list of where each key goes (04-00b/04-02 precedent) |

## Threats

T-04-09 (poison loop → `dead_letter`), T-04-10 and T-04-22 (counts/ids-only details, a renderer that prints nothing
else, synthetic PHI and the scrub vectors asserted absent from real Mailpit messages), T-04-20 (`drill.always_fail`
exists only with `JOBS_DRILL_ENABLED=true`, refused in production; `drill_enqueue` postgres only). No new network
endpoint, route, or API-reachable function other than the two service-role RPCs; `readiness_probe` stays booleans only
for `anon`.

## For the PO

1. **Staging inbox (04-P7):** Vercel `clinicos-staging` → Settings → Environment Variables, Production scope:
   `OPS_ALERT_EMAIL=<the ops inbox address>` (not Sensitive; one address), redeploy. Alerts use the staging
   `EMAIL_PROVIDER` (Resend), so `EMAIL_FROM`/`RESEND_API_KEY` must already be set (04-00b). Check: nothing to see
   until an alert fires; `/api/ready` shows `jobs` booleans.
2. **Alert drill (roadmap "an alert fires in the staging drill"; 04-P8/P9 scheduler first):** set
   `JOBS_DRILL_ENABLED=true`, redeploy; SQL editor: `select ops.drill_enqueue('drill.always_fail', 1, interval '0', 2);`
   wait ~3 min, `select ops.evaluate_alerts();`, within a minute one `[clinicos staging] WARN dead_letter` email arrives
   and `select notified_at, notify_count from ops.alerts where rule = 'dead_letter' and status = 'open'` shows it; then
   `delete from ops.jobs where kind = 'drill.always_fail';`, `JOBS_DRILL_ENABLED=false`, redeploy
   (`docs/runbooks/jobs.md` §12).
3. **Production (V2-15):** `OPS_ALERT_EMAIL` is required by the env schema (boot fails without it).
4. **Rulings (orchestrator as CTO, PO confirms at the gate, 04-P14):** R-50 (D5 accepted) and R-51 (D7 reversed:
   alerts are re-notified every 15 minutes until sent).

## Handoffs

See the 04-04 rows in `04-WAVE-NOTES.md`. **04-06:** add rules by INSERT into `ops.alert_rules`; purge resolved
`ops.alerts` in `ops.cleanup`; list unnotified open alerts in the report. **Close:** add
`tests/jobs/{alerts-db,alert-notify-db,alert-drill-db,alert-email}.spec.ts` to `REQUIRED_FILES`.
