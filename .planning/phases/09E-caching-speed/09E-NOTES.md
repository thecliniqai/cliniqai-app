# 09E notes

## 09E-01 Latency lane, call and depth budgets, baseline

Branch `v2/phase-09e-caching-speed`. No product code, no migration, no new dependency (test harness, CI workflow, package.json script, scripts, docs).

### What shipped

- `tests/e2e/support/server-latency.cjs`: the third preload of the e2e app server (after the network guard and the auth-fault hook). While
  `playwright/.auth/latency.json` exists, every `fetch` to the local Supabase origin (127.0.0.1:54321) waits N ms and is recorded
  (`t0, t1, ms, method, path`; no ids, no query). Nothing else is touched. A call aborted during its wait is not recorded (it never reached Kong).
- `tests/e2e/support/latency.ts`: the browser route (same wait and record, HTTP only), `depthOf`, `callIntervals`, in-page timers
  (`armTimer`/`readTimer`/`timeToVisible`, a MutationObserver armed before the click or key; `timeFullLoad` for a full load), `waitForQuiet`.
- `tests/e2e/perf/latency-run.ts` (engine), `latency-budgets.ts` (the table: id, kind, budget tag, target ms, max ms, owner, per-path ceilings of the
  09D request-budget rows), `latency-ceilings.json` (blocking ceilings, written from the lane's JSON), `latency-pages.ts`, `latency-saves.ts`
  (saves and typeahead), `page-latency.spec.ts`. Project `perf-latency`, `npm run perf:latency`; `PERF_LATENCY_MS` (default 300; 0 is the reference run),
  `PERF_LATENCY_SAMPLES` (default 5), `PERF_LATENCY_MERGE` (one re-measured row joins an earlier summary), `PERF_LATENCY_DEBUG`.
- `request-budget.spec.ts` reads its 09D ceilings from the table (`request.*` rows; same numbers).
- CI: step "Latency budgets" after the PR lane (`npx playwright test --project=perf-latency --grep @budget`, after the PR artifacts are uploaded,
  because it clears `test-results/`), ms table in the step summary, artifact `latency-budgets`. Nightly: job `latency` runs the full lane with an artifact.
- `scripts/perf/latency-ceilings.mjs` (ceilings from a summary; a raise is refused), `scripts/perf/reference-counts.mjs`.
- Unit: `tests/perf/depth.spec.ts` (7), `tests/perf/server-latency.spec.ts` (6); `e2e-app-env.spec.ts` pins the preload order.

### Measures and how they are counted

- Calls = Kong's count, server plus browser, for the window between two Kong markers. Realtime socket upgrades are Kong lines that are not request-response calls
  and are not delayed: counted apart (`realtime`), not in `calls`. The JWKS refresh of the session verifier follows a timer, not the step: counted apart
  (`background`), not in `calls` or `depth`.
- Depth = the largest set of calls with no overlap (greedy by end; an end equal to a start is sequential).
- A window starts only when the page is network-idle and no call has finished for 1 s (2 x the wait + 0.4 s), and ends when the server has been quiet again.
  Kong writes a call's line when it completes, so a call belongs to the window where it completes. Without the quiet wait the 1.2 s settle cut off the
  server's own tail: sign and finish read 46 calls, it makes 93.
- Calibration, every sample: every recorded call lasted at least the injected wait (2 ms timer allowance), and the recorded server, browser and
  background counts equal Kong's. It found two real harness defects on the way (window membership by start time; aborted calls recorded).
- ms are timed inside the page (`performance.now()` from the click or key). `confirmed` of a save is the later of: the state on screen (`shown`) and the
  answer to the page's POST (`response`). Check in has no POST the page can see, so its `confirmed` is the optimistic row move (5 ms): it is not a
  server answer; 09E-08 must give it one.
- Background requests: the `/api/health` probe is refused during every window; `/api/session-status` is refused while a window measures once the device holds its
  `clinic_ctx` cookie (renewed between windows when under 150 s are left). Row `bg.session-status` counts the check on its own (3 calls, depth 3).

### Baseline (tool output, `evidence/baseline/`)

`perf-roundtrips/summary.{json,md}` (`npm run perf:roundtrips`), `perf-latency-0ms/`, `perf-latency-300ms/` (46 rows, 5 samples after one warm-up each),
`reference-counts.json`. Ceilings: `tests/e2e/perf/latency-ceilings.json`; each row's `source` is `perf-latency-300ms/summary.json#<row id>`; maxCalls and
maxDepth are the largest of the row's 5 samples.

Rows furthest from their targets (300 ms, median of 5; calls and depth are the maximum):

| Row | Calls | Depth | ms | Target ms |
| --- | --- | --- | --- | --- |
| save.D.sign-finish | 131 | 46 | 7,291 | 1,000 |
| in-app.D.consult-sealed | 31 | 23 | 5,580 | 1,000 |
| full.D.consult-sealed | 35 | 23 | 5,606 | 1,500 |
| save.D.start-consult | 27 | 17 | 5,285 | 500 |
| in-app.D.consult-draft | 16 | 16 | 4,968 | 1,000 |
| save.D.add-diagnosis | 22 | 20 | 1,272 | 100 |
| save.D.draft-autosave | 1 | 1 | 5,345 | 100 (the autosave waits on its own debounce) |
| save.R.book, register-book, reschedule | 19 | 8-9 | about 2,520 | 500 |

Top by calls: sign-finish 131, consult-sealed (full 35, in-app 31), start-consult 27, collect 22, add-diagnosis 22, full consult-draft 20.
Top by depth: sign-finish 46, consult-sealed 23, add-diagnosis 20, allergies 17, start-consult 17, consult-draft 16.
Within target already: Patients, a patient, Visits (full), Settings, Staff, Billing reports, allergies, both patient searches, check in (optimistic).
Every consult row is far over: the consult page reads 16 times one after another (depth 16 = calls 16), the plan's 09E-05 case.
Typeahead (server route today): medicine 471 ms, substance 469, diagnosis 825 (it also reads `my_entitlements` first, depth 2); patient search 519 against 700.
The full load of the Today board costs 9 to 12 calls and 1.9 to 2.3 s.

### Deviations and decisions

- `node_modules` was a symlink to the other checkout and Turbopack refused it ("Could not find the Next.js package"): replaced by `npm ci` in the worktree (lockfile identical).
- Docker Desktop was found stopped when the run was resumed; it was started again and the local stack came back with its data (no recycle).
- Billing reports: the receptionist has the permission but no nav link, so the in-app row is the owner's (`in-app.O.billing-reports`); the full-load row is the receptionist's.
- Patient search "registration": the register sheet's duplicate check is a server action, not the search route; the two rows are the walk-in sheet on Today and the booking sheet
  (both use `search_patients`). The duplicate check is inside the `save.R.register-book` window.
- A typeahead row ends on a state the last key causes (the "Add ..." row with the full query, or the other candidate leaving the list), never on one the shorter query already showed.
- ms rows with several marks: `pending`/`shown`/`response`/`confirmed` are all in `summary.json`; the report table shows `confirmed`. Skeleton ms is the route skeleton after the click (about 20 ms everywhere it shows; the week switch stays on the same route and shows none).
- No `@budget` typeahead row yet (the catalogues arrive in 09E-09 to 09E-11). `later.*` rows (B-9, B-10, B-12 to B-15) are listed in the table and measured when their plan lands.
- The two `tests/perf` specs are not in `scripts/ci/assert-vitest-report.mjs` REQUIRED_FILES (that registry moves with a migration commit); the floor only rises.
- The live row (B-11) counts the whole window: the second browser's check-in command and the first browser's refresh (11 calls, depth 8). It is nightly-only.
- Ceilings are the highest of 5 samples. Rows that varied in the baseline: `save.D.sign-finish` (93 calls in four samples, 131 in one: its ceiling is loose),
  `full.D.today` (11 or 12). Tighten them in the plan that rebuilds the row.
- `PERF_LATENCY_MERGE` was used once: `live.R.check-in-elsewhere` and `bg.session-status` failed in the first 300 ms run after a local Docker restart
  (a networkidle that never came on the live screen; a refused status check) and passed alone on repeat; their rows were re-measured at the same delay and samples and merged into the 300 ms summary.
  The live row now waits for server quiet, not network idle.

### For the PO

- Sign and finish makes 93 to 131 Supabase calls (46 deep) at depth: about 7 s at staging cost. It is the largest single cost in the lane, ahead of the consult page read (16 deep).
- Check in looks instant because the row moves before the server answers; its server answer is not visible to the page, so a failed check-in cannot be told from the screen.
- The plan order can move 09E-05 (consult) and 09E-08 (saves) earlier if sign and finish is felt first.

### Tests run

- `npx vitest run tests/perf tests/setup/e2e-app-env.spec.ts`: 3 files, 28 tests passed.
- `npm run perf:latency` at 300 ms: 54 passed (8 setup, 46 rows; two rows merged, see above); at 0 ms: 54 passed.
- `npx playwright test --project=perf-latency --grep @budget --retries=0` (the CI step) twice with the ceilings in force: 14 passed each time (8 setup, 6 rows), 4.7 min;
  `tests/e2e/shell/request-budget.spec.ts` on desktop-chrome, pixel-7, iphone-15 (`--retries=0`): 11 passed (setup 8, 3 desktop tests; the other two projects skip by design).
- `npm run typecheck`: clean. `npx eslint .`: 0 errors (390 warnings, none in the files of this plan). `node scripts/ci/workflow-policy.mjs`: pass.
- Not run in CI yet (not pushed): the new CI step and nightly job.

## 09E-02 Observability without a vendor: server timing, database report, real-user monitoring

Branch `v2/phase-09e-caching-speed`. Migration `000122_rum_daily` (000121 stays unused). No new dependency (no `web-vitals`: Next's `useReportWebVitals`).
Commits (not pushed): `da3c52d6` server timing, `88c7556b` perf scripts, `1b90c947` 000122, `02b05210` RUM client + route + guard legs, `07c827ba` reset-page fix,
`53a55977` fixes found by the e2e repeat runs, and the notes commit.

### What shipped

- **Server timing** (`lib/observability/db-timing.ts`, `server-timing.ts`, `route-patterns.ts`, generated `server-routes.ts` + `scripts/observability/server-routes.mjs`):
  one `RequestTiming` per request on the 09D request scope (the header store); the request client's `fetch` (`lib/supabase/server.ts`, also `createPublicClient`)
  and `timedCall` (the breached-password range call) feed it; one `after()` per request writes `request.timing` (route pattern, kind page/action/route, action name, status for
  routes, `db_calls`, `db_ms`, `db_depth`, `total_ms`, outcome ok/refused/error/unfinished). Actions and routes also write `request.start` and one `request.call` per
  call (kind auth/rest/rpc/storage/pwned/..., ms, status, outcome; at most 200 a request), so a call that never ends shows as the last `request.call` and an `unfinished`
  (or missing) `request.timing`. `proxy.ts` forwards `x-clinicos-route` (the pattern from the generated list, never the path) and `x-clinicos-t0` (its start, so `total_ms` counts the
  proxy's own work); both are overwritten on every request and re-validated by the reader. Closed fields only (`lib/log/fields.ts`): no URL, query, id, name or error text.
- **Action names**: every exported Server Action (121 exports, 27 modules) starts with `await markAction("<module>.<name>")` (Next gives only a hashed id).
  `tests/observability/action-names.spec.ts` parses every `"use server"` module and fails on a new action without it, a name the logger would drop, or a duplicate.
- **Server-Timing** on the data routes through `timedRoute(handler)`: `db;dur=<ms>;desc="calls=<n> depth=<d>", app;dur=<ms>`.
  Covered: GET `/api/terminology/diagnoses`, `/api/terminology/substances`, `/api/prescriptions/medicines`, `/api/patients/search`, `/api/patients/[id]/export`,
  `/api/invoices/[id]/receipt-pdf`, `/api/visits/[id]/prescription-pdf`, `/api/session-status`, `/api/reports/view`, `/api/r/[token]`, and POST `/api/rum`.
  Pages and actions write the line (every page or action that makes a request-client call; `/login`-style pages with no call write none).
  Not covered: `/api/v1/**` (API-key routes on the service-role client), `/api/health`, `/api/ready`, `/api/jobs/run`, `/api/webhooks/messaging`, `/api/auth/send-email`,
  `/api/diag/error`, `/api/reschedule/[token]`, `/auth/signout` (its calls still write a line), `/sw.js`.
- **Database and staging tools**: `npm run perf:db-top` (`scripts/perf/db-top-queries.ts`; docker exec into the local container, refuses any non-loopback target; `--reset` first
  for a measured run) writes `evidence/db-top-queries.{json,md}` (top 25 by total and by mean); `scripts/perf/top-queries.sql` is the same read-only SELECT for the PO's SQL editor.
  `npm run perf:staging-smoke` (`scripts/perf/staging-smoke.ts`): headed, the PO signs in by hand; `--local` (loopback only, `SMOKE_EMAIL`/`SMOKE_PASSWORD` from `seed:local`)
  is how it was checked. Steps: Today, Today to a consult, Schedule day and week, Patients, Patients to one patient, one medicine search, one diagnosis search; per step the app's own
  data-ready mark, Server-Timing of the data routes and LCP/CLS/FCP/TTFB. Local run: 7 measured, 1 skipped (the demo clinic has no consult link on Today), 0 failed
  (`evidence/staging-smoke-2026-11-24.{json,md}`).
- **000122** (`supabase/migrations/000122_rum_daily.sql`, pgTAP `rum_daily.test.sql`, 63 tests): `ops.rum_daily`, `ops.rum_overflow` (RLS on, no grant, `ops` unserved),
  `public.ops_ingest_rum` (definer, `search_path=''`, EXECUTE `authenticated` only), `ops.rum_report(p_days)` (postgres only), `ops.cleanup()` also deletes rum rows past 90 days,
  `CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions` (a no-op on the local stack, which has it). Bumped in the same commit: `EXPECTED_MIGRATION`,
  schema snapshot, `types/database.ts`, `assert-pgtap-report.mjs` (REQUIRED_FILES, FLOOR 9025 + 63 = 9088, measured 9088 in 70 files), `definer_functions.test.sql` (three registry rows).
- **Client RUM** (`lib/observability/rum/{catalog,collector,ingest}.ts`, `components/shell/{rum-reporter,data-ready}.tsx`): the five Web Vitals plus `nav_data_ready`, `load_data_ready`,
  `search_server` (the patient picker and the diagnosis search: keystroke to the answer's first option; `search_device`, `save_*`, `finish_confirmed`, `live_*` are accepted by the route and
  the database but nothing emits them until 09E-04 and 09E-08 to 09E-11). `DataReady` is rendered by `withPageAuth` after every wrapped page (one place, every main screen).
  One sampling decision per session (`NEXT_PUBLIC_RUM_SAMPLE_RATE`, default 1; in `lib/env.ts`, `.env.example`, the e2e env), batches of at most 60, flush at 60 samples, every 60 s and
  `sendBeacon` on hide and `pagehide`. **`POST /api/rum`**: same origin, session (any member, any access level), 8 kB, strict zod, 10 batches a minute per user (in process), environment
  and release from the server, 204 `private, no-store`. Guard manifest kind `rum-ingest` with its legs.
- **Staging finding**: see the last block.

### Fails-without (High: nothing identifying reaches `ops`)

Recorded with temporary copies of the pgTAP file (deleted): (1) `ops_ingest_rum` with its `screen` closed-list check removed: the three screen cases fail (the table CHECK still refuses the row, 23514 instead of
the function's 22023: two layers). (2) The same plus `rum_daily_screen_check` dropped: a sample whose screen is a uuid or a path is accepted ("ok"), writes a row (5 rows against 9; counts 7 against 11) and the
closed-word check fails: 6 of 63 tests fail. Both restored (the migration file was never edited); the committed test passes 63 of 63.

### Staging finding (2026-11-23): what changed

- Every action and route now writes `request.start`, a `request.call` per external call and `request.timing` (see above); the breached-password call is timed as `pwned`. A stall inside the function shows as the last
  `request.call` and no (or an `unfinished`) `request.timing`.
- `saveWithRecheck` (`features/auth/password-flows.ts`, used by the reset page): when the Server Action call throws, the page shows "Checking whether your password was saved...", asks Supabase Auth whether the
  recovery session still exists (a reset ends it, R-35), retries once if it is open, treats a retry answered `session_not_found` as saved, and otherwise says "We couldn't confirm that your password was changed..."
  (never "We couldn't reset your password" for an unknown outcome). Unit: `tests/auth/password-save-recheck.spec.ts` (12). e2e: `tests/e2e/auth/j-a4-reset.spec.ts` loses the answer after the server ran the
  save, and before it arrived; both end with "Password changed" and the new password signing in, and the log holds `request.start` for `auth.set_new_password_action`.
- **Not done (needs the PO)**: reproduce on staging after an idle period with the new lines before closing (agents never touch staging).

### Decisions and deviations

- **Action names are carried by a one-line `markAction` call** (121 sites) because Next exposes only hashed action ids; enforced by the spec above, not by the inventory (its fixtures would change).
- **A line per external call** (not only slow ones) for actions and routes, capped at 200 per request. A 93-call action (sign and finish) writes about 95 lines. The cap and the "only slow or failed" alternative are
  the PO's call if log volume matters.
- `db_ms` is the calls' times added up (parallel calls add); `db_depth` is the chain length (same rule as the latency lane, `depthOfIntervals` = `depthOf`).
- The service-role factory (`lib/supabase/system.ts`, ADR-0005 D2) is not instrumented (security-sensitive file, no change): calls on the system client (API v1, webhooks, jobs, share links, invite acceptance) are not counted.
- `ops.rum_report` returns `environment` and `samples` besides the plan's columns (a local database mixes e2e and test rows). A percentile in the open top bucket is `Infinity`.
- The plan's "fails-without" says a uuid screen writes a row with the function's check removed; the table CHECKs make that a second layer, so the proof has two steps (above).
- `x-clinicos-t0` is added beside the route header (the plan names only the route): `total_ms` then includes the proxy's own auth time.
- A reset saved with a lost answer shows the notice "We could not sign out your other devices" (the recheck cannot know that the global sign-out ran); harmless, but wrong when it did.
- nav timing starts at a click on an in-app link; a programmatic `router.push` is not timed (09E-03/04 can add a call).
- The route's rate limit counts every attempt including refused bodies; a user who loads pages by full load more than 10 times a minute loses samples (429, no user-visible effect).
- `POST /api/rum` is a new route kind in the guard manifest and `ops_ingest_rum` a new definer function: security-sensitive per CLAUDE.md DoD 6 (adversarial second review needed).
- No git identity is configured on this machine: the commits are authored `Claude <noreply@anthropic.com>` through environment variables (no config changed).
- `assert-vitest-report.mjs`: REQUIRED_FILES gains the 09E-01 perf specs and the nine 09E-02 specs; its FLOOR (6455) is unchanged (re-measure at the phase gate).
- `evidence/db-top-queries.*` is from the staging-smoke walk on the local stack (counters reset before it); `staging-smoke-2026-11-24.*` likewise. Re-run both at the gate.

### For the PO

- Sign and finish aside, the first thing worth looking at on staging after this lands: run `top-queries.sql` in the SQL editor and `ops.rum_report(7)`; the function log now has a `request.timing` line for every page, action and covered route.
- To reproduce the finding: leave staging idle, run a password reset, and read the `request.start` / `request.call` / `request.timing` lines for `auth.set_new_password_action`.

### Tests run (local stack, after `db reset --local` and `stack:recycle`)

- `npm run typecheck`: clean. `npx eslint .`: 0 errors (390 warnings, the 09E-01 number). `npm run inventory`: 0 flagged (27 modules, 122 exports, 35 route modules, 57 methods).
  `node scripts/ci/env-example.mjs --check`, `node scripts/observability/server-routes.mjs --check`, `node scripts/ci/workflow-policy.mjs`: pass.
- pgTAP: `npm run test:pgtap`: 9088 tests in 70 files, 0 failed; `assert-pgtap-report.mjs`: PASS at floor 9088. `rum_daily.test.sql` 63 of 63; `definer_functions.test.sql` 109 of 109.
- Vitest: 72 files, 1481 tests (observability, auth, config, api readiness, ci, terminology, patients search route, pwa session-status, perf, subscriptions redirects) all pass after fixing one test of my own (the 429 window);
  `tests/security/guard-routes.spec.ts` + `guard-actions.spec.ts`: 743 passed (includes the new `rum-ingest` legs); final re-run of observability, password recheck, config and perf: 753 passed.
- e2e (desktop-chrome and pixel-7, `--retries=0`): `observability/rum.spec.ts` 11 passed twice in a row (setup 8 + 3); `auth/j-a4-reset.spec.ts` incl. the two lost-answer cases, `consult/keyboard-golden.spec.ts`,
  `shell/request-budget.spec.ts`: 24 passed, 8 skipped by design. `npx playwright test --project=perf-latency --grep @budget --retries=0`: 14 passed (5.3 min), ceilings unchanged (the timing adds no Supabase call).
- Repeat-run findings fixed (not retried): the RUM e2e shared the doctor with other specs and hit the 10-batches-a-minute limit on the second device project; a link clicked before hydration was a full load; the Web Vitals were
  counted two or three times (unstable callback); the resource-timing buffer was full (observer instead of getEntries).
- `npm run perf:staging-smoke -- --local`: 7 measured, 1 skipped, 0 failed. `npm run perf:db-top`: 28 statements written.
- Not run: the full Vitest suite and the full e2e PR lane (CI does); the staging reproduction (PO).
