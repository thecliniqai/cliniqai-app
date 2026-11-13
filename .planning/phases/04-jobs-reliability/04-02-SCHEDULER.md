---
phase: 04
plan: 04-02
subsystem: jobs/scheduler (pg_cron → pg_net → /api/jobs/run)
status: complete
requirements: [P0-12, RL-23]
plan_head_before: 84256d1640467682484405e96a91769bd54afd52
commits: [470d0fc, e027cdb, 3caabac, 97edec4, 4872619, 4d0bfc5]
---

# 04-02 record: scheduler (pg_cron → pg_net → `/api/jobs/run`)

**Outcome:** done locally, with one ruling needed (R-16, below). The full path ran for real once on macOS: pg_cron
`jobs-kick` → `ops.kick_job_runner()` → Vault → pg_net → `POST /api/jobs/run` on the e2e build → runner → 5/5
`drill.noop` done, one `pg_cron` runner pass, one pg_net response 200, queue lag p95 27.5 s
(`evidence/scheduler-local-e2e.json`, tool output). CI tests the DB half and the route half separately (pitfall 6,
R-21). Nothing contacted a hosted project, Vercel or GitHub settings; no `--linked`, no `db push`; no dependency added.

## What shipped

| Commit | Content |
|---|---|
| `470d0fc` | Env keys (R-15 checklist): `JOBS_RUNNER_SECRET`, `JOBS_RUNNER_SECRET_NEXT`, `JOBS_DRILL_ENABLED` in `lib/env.ts` (schema, `Env`, tier rules, `ENV_DOCS`), `.env.example` regenerated, `environment.txt.example` (Vercel + Vault lines); `tests/config/{env-schema,env-boot}.spec.ts`; test-lane guard (`tests/setup/test-env.ts`, `LOCAL_JOBS_RUNNER_SECRET` built at run time) + `test-env-guard.spec.ts`; e2e server value in `tests/e2e/support/app-env.ts` |
| `e027cdb` | Migration `000033_jobs_scheduler.sql`, `EXPECTED_MIGRATION = "000033"`, `scripts/drift/schema-snapshot.txt` regenerated after `db reset --local` (types unchanged: `ops` only; `npm run db:drift:local` PASS, 0 allowlisted); `tests/jobs/scheduler-migration-db.spec.ts`; cron pause/resume in both global setups (`tests/setup/cron-pause.ts`) |
| `3caabac` | `app/api/jobs/run/route.ts`, `lib/jobs/auth.ts`, `lib/jobs/internal/{registry.ts,handlers/drill.ts}`, `runJobs` returns `ok`, reason `jobs.run` in `lib/supabase/system.ts`, `proxy.ts` session-less path; `tests/jobs/{run-route,runner-auth}.spec.ts`, `runner.spec.ts` (+`ok`), `tests/api/proxy-matcher.spec.ts` |
| `97edec4` | Guard manifest + engine kind `runner-secret` (+ `guard-routes.spec.ts`), lint fixtures on the real runner, real-file lint cases, `tests/e2e/jobs/run-route.spec.ts` |
| `4872619` | `docs/runbooks/jobs.md` (new), `docs/ops/secret-rotation.md`, `scripts/ops/scheduler-local-e2e.ts`, `evidence/scheduler-local-e2e.json`, `evidence/04-02/pg-net-revoke-probe.txt` |
| `4d0bfc5` | D9: `scripts/drift/hosted-dump-diff.mjs`, `tests/ops/{backup-runs,restore-drill-checks}-db.spec.ts` kept green with pg_cron on the stack |

### Migration 000033

- `create extension if not exists pg_cron` / `pg_net with schema extensions` (fails loudly where missing, R-34).
- `ops.kick_job_runner() returns bigint` (definer, `search_path = ''`, owner `postgres`): reads `jobs_runner_url` and
  `jobs_runner_secret` from `vault.decrypted_secrets`; NULL without a request when either is missing or blank; raises
  `22023 jobs_runner_url_refused` unless the URL is `https://<host>[:port][/path]` or plain `http://` to `127.0.0.1`,
  `localhost` or `host.docker.internal` (no userinfo, no IPv6 literal, no whitespace); raises
  `22023 jobs_runner_secret_refused` unless the secret is 32-512 printable ASCII without spaces (same rule as the env
  schema, so a CR/LF cannot reach a header); `net.http_post(url, {"source":"pg_cron"}, Content-Type + Authorization:
  Bearer, timeout 30000)` (R-17).
- `ops.drill_enqueue(kind, count = 1, spread = '0', max_attempts = 2) returns int`: `^drill\.[a-z_]+$` only, 1..500,
  spread 0..1 day, `run_at` evenly over the spread, empty payload, no tenant, key `drill:<kind>:<uuid>`.
- Both: `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` (executable by `postgres` only).
- Name-keyed schedules (re-applying updates in place): `jobs-kick` `* * * * *` `select ops.kick_job_runner()`,
  `jobs-reap` `* * * * *` `select ops.reap_jobs()`, `cron-history-cleanup` `15 0 * * *` (05:45 IST) deleting
  `cron.job_run_details` older than 7 days.

### Route and auth

`isAuthorisedRunner(header, { current, next })`: `Bearer ` exactly; SHA-256 of the given value vs SHA-256 of each
configured secret with `timingSafeEqual` (both 32 bytes: never throws, length never leaks); with a rotation slot both
comparisons always run; no current secret → false without comparing. Route: auth (secrets read through `serverEnv()`;
a refused environment authenticates nothing) → body ≤ 1 KB (413), JSON `{ source?: "pg_cron" | "manual" }` strict
(400) → `runJobs(getSystemDb("jobs.run"), 25 s, batch 25, lease 120 s, 10 per tenant, worker
<region|local>:<8 hex>)` → `{ ok, claimed, done, retried, dead, durationMs }`; a throw → 500 `{ ok: false }` +
`jobs.run.failed` with `errorTag` and the request id; `GET/PUT/PATCH/DELETE` → 405 `Allow: POST`. `proxy.ts` treats
`/api/jobs/run` like the probes (no session client, request id still set).

## Tests (fail without the change; `evidence/04-02/before-vitest.txt`)

Before-run: the specs on pre-plan `84256d1` (throwaway worktree, stack reset to 000032 from it): 8 of 9 files fail,
49 tests (route and auth specs fail at import; 27 of 29 migration cases fail; env, runner `ok`, proxy, lint and guard
completeness cases fail). `test-env-guard.spec.ts` passes there only because its subject (`tests/setup/test-env.ts`)
had to be copied in with it. The two migration cases that pass before are invariants this plan must keep (`net` not
served by PostgREST; no API-schema function references `net.`).

| Spec | Proves |
|---|---|
| `tests/jobs/scheduler-migration-db.spec.ts` (29) | extensions (pg_net in `extensions`); the three schedules exactly once as `postgres` with schedules/commands; the lane paused them; re-applying the file (rolled back) keeps one row per name and the same ids (A8); kick without secrets → NULL, nothing queued (3 combinations); with synthetic secrets (rolled back, never sent) one POST: URL, `sha256(Authorization) = sha256("Bearer " + secret)`, JSON body, `timeout_milliseconds = 30000`; https / localhost / Docker host accepted; plain http to a public or private host, userinfo, a loopback name as userinfo, whitespace, another scheme, a short or spaced secret → `22023` with the reason, never the value; `net` → PGRST106 for anon and a signed-in owner; no API-schema function references `net.`; only the kick calls `net.http_` or names `jobs_runner_secret`; no API role executes the two functions or uses `cron`; anon/authenticated have no Vault access; both definer + empty search_path + owner postgres; drill enqueue spread 0/300/600 s, `{}`, no tenant, key shape; 6 refusals; API roles refused |
| `tests/jobs/run-route.spec.ts` (24) | tracer: a `drill.noop` from `ops.drill_enqueue` → 200, exactly six keys, job `done`, < 25 s, one `pg_cron` runner run, `db.system_acquired` with reason `jobs.run`, no id in body or log; 5 jobs drained in one pass, empty body = `manual`; NEXT secret → 200; drills off → claimed 0, job pending; refusals (no secret incl. `Bearer undefined` / old secret / empty; schema-refused secret; no header; wrong; shorter; longer; scheme-less; lower-case scheme; other header; an owner's session cookie; an owner's access token as bearer) → 401 `{"ok":false}`, job pending, **no runner run and no `db.system_acquired`** (no DB access); GET/PUT/PATCH/DELETE → 405 `Allow: POST` with and without the bearer; body > 1 KB → 413; not JSON / unknown key / unknown source / array → 400; a factory throw → 500 `{"ok":false}`, one `jobs.run.failed` line with `code: "Error"`, no message |
| `tests/jobs/runner-auth.spec.ts` (22) | accepts `Bearer <current>`; 14 refusals (prefix, case, spacing, one char changed, prefix/suffix, 64× longer, random, literal `undefined`); `node:crypto` `timingSafeEqual` wrapped: every call gets two 32-byte buffers, never throws on any length; with NEXT both comparisons run for a match on either and for a mismatch; NEXT refused once unset; no current secret (or only NEXT) → false and nothing compared |
| `tests/jobs/runner.spec.ts` (+`ok`) | `ok: true` on a clean pass, `ok: false` when a queue RPC fails |
| `tests/api/proxy-matcher.spec.ts` (+6) | `/api/jobs/run`, `/api/health`, `/api/ready` (POST and GET, with a cookie): no session client built, no Set-Cookie, a fresh request id over a caller-chosen one; controls `/api/jobs/run/x`, `/api/jobs`, `/api/patients/abc/export` build one |
| `tests/config/env-schema.spec.ts` (+16), `env-boot.spec.ts` (profiles) | staging/production without the secret; a 20-character or spaced secret in production, staging and test; NEXT equal to current; NEXT without current or short; runner = cron secret; padded secret and NEXT (both in `SECRET_ENV_NAMES`); local tiers may leave it unset; `JOBS_DRILL_ENABLED=true` refused in production, allowed in staging, default false, non-boolean refused; the e2e server env parses with drills on and a 32+ secret. Every message names the key, never the value |
| `tests/setup/test-env-guard.spec.ts` (+2) | the lane accepts only `LOCAL_JOBS_RUNNER_SECRET` (64 characters) and never echoes another value; no rotation slot; drills off in Vitest, allowed for the e2e server |
| `tests/security/guard-routes.spec.ts` (+5 routes) | `runner-secret` legs for POST (unset ×3, no header, wrong, different length, scheme-less, member session → 401 `{"ok":false}`, no ids, no request-client access; right bearer → 200 with the six keys) and GET/PUT/PATCH/DELETE (405 `Allow: POST`, empty body, with and without the bearer); completeness fails until the manifest has the five entries |
| `tests/security/system-db.spec.ts` (unchanged) | covers `getSystemDb("jobs.run")` → one `db.system_acquired` line with module `app/api/jobs/run` (iterates `REASON_OWNER`) |
| `tests/security/p1-34-lint-gates.spec.ts` (+9) | `factory-import` fails at `lib/jobs/enqueue.ts` and `lib/jobs/auth.ts`; the real route, registry, drill handler and auth module lint clean in place; the route's real source fails as a server action (3 imports), the enqueue surface (3) and a register route (2: the internals; the register may hold the factory until P1-37). Existing cases (action / v1 route importing `@/lib/jobs/internal/runner` fail; `app/api/jobs/run/route.ts` passes) now run on the real module (fixture typechecked) |
| `tests/e2e/jobs/run-route.spec.ts` (2, desktop) | real server: POST without bearer → 401 `{"ok":false}` with `x-request-id`, wrong bearer → 401, job pending; e2e secret → 200 with the six keys, job `done`; GET → 405 `Allow: POST`, job pending |

## Gates (tool output in `evidence/04-02/`)

- `npm run typecheck` clean; `npx eslint .` 0 errors (warnings pre-existing); `npm run inventory` exit 0.
- `npm run db:drift:local`: PASS, 0 statements, 0 allowlisted (no K-12 false positives from the extensions).
- `npm run e2e:build`: output scan clean (1 365 files) (`e2e-build.txt`).
- `npm run e2e:pr` (desktop, Pixel 7, iPhone 15): 190 expected, 9 skipped, 0 unexpected, 0 flaky, 0 retried results
  (`e2e-pr.txt`; the ✘ lines are `knownBug` expected failures).
- Full Vitest lane (`npm run test:db`, `vitest-full.txt`): run 1 at `4872619` had 7 failures in 3 files of other
  plans (D9); after `4d0bfc5`: **178 files, 3 797 tests passed, 0 failed**; teardown verified; every `cron.job` row
  active again afterwards.
- gitleaks 8.30.1 (docker, `--network none`) over the full history after the commits: no leaks found.

## Deviations

| # | Plan said | Done | Why |
|---|---|---|---|
| D1 | `REVOKE USAGE ON SCHEMA net`, `REVOKE ALL ON ALL TABLES IN SCHEMA net`, `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA net` from `PUBLIC, anon, authenticated` (R-16); test "anon and authenticated lack USAGE on `net`, EXECUTE on `net.http_post`, SELECT on `net.http_request_queue`" | **Not shipped; raised for a ruling.** Compensating assertions instead (PostgREST refuses `net`; no API-schema function references `net.`; only the kick calls pg_net or reads the secret; API roles cannot run the kick or read Vault) | Every `net` object is owned by `supabase_admin`, whose `grant_pg_net_access` event trigger grants anon/authenticated and which leaves the queue tables to PUBLIC. Migrations run as `postgres` (not superuser, not the grantor), so each REVOKE is a no-op with `WARNING: no privileges could be revoked` (`evidence/04-02/pg-net-revoke-probe.txt`). Shipping it would read as a control that does not exist. See "Ruling needed" |
| D2 | `runJobs` result `{ claimed, done, retried, dead, stale, released, durationMs }` (04-01) | + `ok` | The route's `ok` must say whether the pass completed; without it a failed queue RPC would answer `ok: true`. 04-01's runner spec asserts it |
| D3 | `jobs-internal-relative.ts` placeholder replaced by the real path | Keeps `// @ts-nocheck` (reason updated); `jobs-internal-import.ts` now imports the real `runJobs` and is typechecked | `./internal/runner` resolves only at the virtual path `lib/jobs/enqueue.ts`, not at `lint-fixtures/p1-34/`. The real route source is linted instead (stronger: the actual file, moved to three zones) |
| D4 | body ≤ 1 KB | > 1 KB → 413 (read bounded, never buffered whole); bad JSON / unknown key → 400 | Explicit statuses; all bodies `{"ok":false}` |
| D5 | (not in plan) | Kick refuses a short/spaced secret and URLs with userinfo/IPv6/whitespace; env schema refuses a runner secret equal to `CRON_SECRET` and NEXT without a current; `_NEXT` names join `SECRET_ENV_NAMES` (padding refused) | Rule 2 hardening (header injection, a dedicated secret per R-16/R-27, rotation slot as secret as the value it rotates) |
| D6 | e2e "sets its own synthetic secret" | e2e uses the lane's `LOCAL_JOBS_RUNNER_SECRET` (exported as `E2E_JOBS_RUNNER_SECRET`) | the guard allows exactly one synthetic value in every test lane (like the ingest key and the hook secret); the Vitest lane leaves it unset and stubs random secrets |
| D7 | test lanes set cron inactive, teardown sets "them" active | teardown sets **every** row active | heals a killed run (otherwise the local stack's schedules would stay off until the next `db reset`) |
| D8 | (not in plan) | `environment.txt.example` gained the runner/drill lines and the Vault SQL | the PO's single list of where each key goes (04-00b precedent) |
| D9 | (not in plan; Rule 1/3, caused by 000033) | `scripts/drift/hosted-dump-diff.mjs` skips `pg_*` schemas and does not load `pg_cron` into its scratch DB; `restore-drill-checks-db.spec.ts` emulates a restore with `cron.unschedule`; `backup-runs-db.spec.ts` empties `ops.job_runner_runs` inside its rolled-back probe | With pg_cron installed a schema dump says `CREATE EXTENSION "pg_cron" WITH SCHEMA "pg_catalog"` (the tool tried `create schema pg_catalog`; pg_cron cannot exist outside `cron.database_name`; a staging dump will carry the same line); `postgres` may not DELETE from `cron.job`; the stale-runner probe assumed no ok runner pass in the shared lane, false once real passes exist. Each failed in the first full run and passes now |

## Ruling needed (R-16, T-04-02) — for 04-P14 and review group B

As built, while a kick waits for the pg_net worker (normally well under a second), its `Authorization` header sits in
`net.http_request_queue`, which every database **login** role can read (PUBLIC has all privileges; owner
`supabase_admin`). Login roles on a hosted project include `postgres`, `authenticator`, `supabase_auth_admin`,
`supabase_storage_admin`, `supabase_read_only_user` and the V2-03 read-only role `clinicos_drift_ro` (used by GitHub
workflows). anon and authenticated cannot log in and cannot reach `net` through the API (asserted). Impact of a leaked
runner secret: extra runner passes over due work only (idempotent; no data returned; never the service key).

Options: **(a)** accept with the compensating checks + rotation runbook (§3, §7 of `docs/runbooks/jobs.md`) —
implemented; **(b)** replace the static bearer with a short-lived token (`<unix ts>.<HMAC-SHA256(secret, ts)>` built in
`ops.kick_job_runner()` with pgcrypto, verified by the route with a ±2 min window and constant-time compare), so the
queue never holds the secret — an auth-approach change (Rule 4), not done; **(c)** ask Supabase support whether the
`net` grants can be narrowed on the hosted project. Recommendation: (a) now, (b) before production (V2-15) if the
review agrees the read-only role's exposure matters.

## Handoffs

- **04-03a/b/c, 04-04:** add kinds to `PRODUCTION_HANDLERS` in `lib/jobs/internal/registry.ts` (the route claims exactly
  those); 04-04 adds alert drills to `DRILL_HANDLERS`. `drill.noop` belongs to the two run-route specs (they delete every
  `drill.noop` row): use another `drill.*` kind elsewhere. Specs never rely on pg_cron firing (lanes pause it).
- **04-04:** `runner_stale` keys on Vault `jobs_runner_url` presence (as `ops.backup_runner_stale` does); kick failures
  surface in `cron.job_run_details.return_message` as `jobs_runner_url_refused` / `jobs_runner_secret_refused`.
- **04-06:** retention of `ops.job_runner_runs` (one row per minute per environment from now on).
- **Close:** add `tests/jobs/{scheduler-migration-db,run-route,runner-auth}.spec.ts` to `REQUIRED_FILES`.
- **PO:** 04-P8 now also requires the runner secret to differ from `CRON_SECRET` (the schema refuses equality).
