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

## 09E-03 Client data layer: TanStack Query, with Today on it

Branch `v2/phase-09e-caching-speed`. No migration. One new dependency: `@tanstack/react-query` 5.108.4, exact pin (reason: one memory-only client data layer, R-14; the lockfile adds it and `@tanstack/query-core` only, MIT, registry URLs and integrity hashes unchanged in form). No persister, no devtools.

### What shipped

- **`lib/query/`**: `policy.ts` (`createQueryClient`: staleTime 30 s, gcTime 5 min, reads retry once, mutations never, refetch on focus and reconnect, `networkMode: "online"`),
  `keys.ts` (`queryKeys.{clinic,today,todayAll}`, tenant id first, ids and modes only; the `meta` slot is typed with `domains` for 09E-04 and `live`),
  `client.ts` (`registerQueryClientCleanup`: cancel in-flight reads, `clear()`, then tell the provider), `provider.tsx` (one client per mounted provider, never module level; after a clear it renders no children),
  `server.ts` (`createRequestQueryClient`, `dehydrateRequest`; `server-only`).
- **Provider** wraps the screens inside the shell (`app/(dashboard)/layout.tsx`: `QueryProvider` around `ResumeRefresh`, `{children}` and `FrontDeskSheets`, inside `AppShell`). The shell chrome (top bar, "Switching...", sign-out items) stays outside it.
- **Clearing**: `CleanupKind` gains `"switch"`. Sign-out and lock already ran the registry; `useClinicSwitch` now runs `runCleanups("switch")` after `switchClinic` succeeds and before the hard navigation (`lib/pwa/lock.ts` needed no edit: it already calls `runCleanups("lock")` before its `replace`).
- **`GET /api/today/board?mode=`** (`app/api/today/board/route.ts`): `resolveServiceContext("appointments:view")`, tenant and role from the session (a `tenant` parameter is ignored), `resolveMode` per role (doctor mode reads only the session user's visits),
  the existing `getTodayBoard`, 401/403/403 `SUBSCRIPTION_LOCKED`/503/500 with fixed bodies, `private, no-store`, `timedRoute` (Server-Timing + `request.timing`). Body is the board itself (`rows, generatedAt, today, timeZone`). Guard manifest kind `session-board` with legs
  (`sessionBoardRouteLegs`: least-privileged holder gets 200, no-store, exactly those keys, a forged `tenant`/`tenantId` changes nothing, nothing of tenant B). `server-routes.ts` regenerated.
- **Today**: the page still reads the board once on the server and hydrates `queryKeys.today(tenantId, mode)` (`HydrationBoundary`); `TodayBoardView` is now a `useQuery` shell over the old component (`TodayBoardLoaded`); the date line is computed on the client from `board.today`/`timeZone` (it used to be a server prop that only `router.refresh()` updated).
  `use-today-live.ts` keeps its 400 ms coalescing and 20 s fallback poll; its refresh is `invalidateQueries(todayAll(tenant), { cancelRefetch: false })` (a read already in flight answers it), no `refreshWhenReachable` probe (a failed fetch keeps the rows; offline the query pauses itself).
  Resume moved out of `AppShell` into `components/shell/resume-refresh.tsx` (it needs the client): `/today` invalidates the `meta.live` queries; the schedule (not on the layer yet) still gets `router.refresh()` through `refreshWhenReachable`.
- **Lint**: `no-restricted-imports` group `queryPersist` (`@tanstack/*persist*`, `@tanstack/react-query-devtools`, `@tanstack/query-devtools`), checked with a throwaway file (both imports error).
- **Budget row** `live.today.refresh` (kind live, B-11, owner 09E-06) in `latency-budgets.ts`, its test in `page-latency.spec.ts` (a resume trigger on Today, waits for the board response), ceiling from the lane's own output
  (`evidence/09E-03/live-today-refresh-300ms.json` -> `latency-ceilings.mjs`, no number typed): **8 calls, depth 8** at 300 ms (4 `tenants`, 2 `visits`, 2 `memberships`; no invoice read in that clinic day). 09E-06 lowers it to 1 and 1.

### Fails-without (High: data crossing clinics)

With the `registerQueryClientCleanup` registration removed from `provider.tsx` (rebuilt, restored, rebuilt): `query-clear.spec.ts` "clinic switch" fails on desktop-chrome and pixel-7. The old page, still on screen while the navigation to the new clinic is held for 3 s,
ends with a row of the **new** clinic (`ClearRowB`) under the old clinic's key: after the cookie flipped, a refetch landed in the old page's query. With the registration the last report of the old document is "no rows". Sign-out case still passes without it (the document is concealed and replaced), as expected.
Restored; committed code passes both.

### `npm run ci:route-js` (B-15, report-only)

| Route | Before (09E-02 tree) | After | Growth |
| --- | --- | --- | --- |
| `/today` | 331.8 kB gz | 344.2 kB gz | +12.4 kB (route-specific 203.1 -> 215.5) |
| `/consultation/[id]` | 395.1 kB gz | 403.8 kB gz | +8.7 kB |

Framework root unchanged (128.7 kB). The provider is in the dashboard layout, so every dashboard route grows by the library (about 8.7 kB gz); Today adds its own hook code. Budgets (200/150) were already over before.

### Decisions and deviations

- **The Today page is hydrated, not replaced**: a server action that revalidates the page still re-renders it and the newer `dataUpdatedAt` replaces the cached board (the same-tab check-in path keeps working without a signal).
- **Doctor mode**: the snapshot panel and the amendments list are still server-rendered props. A board-only refresh would leave them stale, so when the doctor's Next patient changes, the board runs one `router.refresh()` (same safe-refresh guard), once per change. Everything else refreshes without a page render.
- **After a clear the provider renders nothing** (not a spinner): the page is about to be replaced by a hard navigation; this is also what makes the clear observable (e2e) without a test hook in product code.
- **The resume hook moved** from `AppShell` to `ResumeRefresh` inside the provider (needs the client). `startResumeRefresh` and its 2 s coalescing are unchanged.
- **Found and fixed (09E-02 defect)**: `05-cache-audit` failed on the tree before this plan: the RUM collector kept its sampling decision in `sessionStorage` under `clinicos.rum.sampled`, a key outside the D-3 list (the spec allows `clinicos.pref.*` only). It now lives in memory for the page's lifetime (every full load decides again; at the default rate 1 nothing changes).
  I did not add a key to `DEVICE_PREF_KEYS` (a spec pins exactly five). 09E-02's notes did not list that spec among the ones it ran.
- `tests/e2e/today/today-live.spec.ts`: the two connection-drop cases were written around the `/api/health` probe and RSC counts; they now say the same thing for the board read (offline: 0 board reads and 0 RSC; the board GET aborted: rows stay, no navigation, no RSC; the next tick catches up). The signal case asserts one board read, `Server-Timing` on it, and 0 RSC requests.
- `Server-Timing` on the route is asserted in the e2e (a unit test has no request scope).
- `tests/today/live.spec.ts` needed no change: `createTodayLive` takes `refresh` as a dependency and its rules are unchanged.
- `assert-vitest-report.mjs` REQUIRED_FILES + `tests/query/{keys,cleanup}.spec.ts`, `tests/api/today-board-route.spec.ts`; FLOOR unchanged (re-measure at the phase gate).

### Security-sensitive for the adversarial review

`app/api/today/board/route.ts` and its guard kind (`session-board`, `engine.ts`, `guard-manifest.ts`), `lib/pwa/cleanup.ts` (new kind) and the clear on exit paths (`lib/query/*`, `clinic-switcher.tsx`), the lint ban, the dependency (`package-lock.json`: two packages), and the RUM storage fix. No migration, no RLS change, no service-role use.

### For the PO

- Open question: the route does 8 Supabase calls (4 of them `tenants`) at depth 8; that is the current service, not new, and 09E-06's `today_board` brings it to 1. Nothing to decide now.
- `/today` first-load JS grows 12.4 kB gz (report-only, FE-9). The plan expected about 13 kB.

### Tests run (local stack)

- `npm run typecheck`: clean. `npx eslint .`: 0 errors (390 warnings, unchanged). `npm run inventory`: 0 flagged (36 route modules, 58 methods). `node scripts/observability/server-routes.mjs --check`: pass.
- Vitest: `tests/security tests/pwa tests/perf tests/today tests/query tests/api/today-board-route.spec.ts tests/observability tests/lint tests/ci tests/shell`: 110 files, 2651 tests passed (includes guard-routes and guard-actions with the new kind, the lint-gate specs, the new specs: keys 3, cleanup 6, route 6).
- e2e (`--retries=0`, desktop-chrome and pixel-7, `stack:recycle` before each run, never mid-run): `today/*` (today-live 5 each, front-desk, review-fixes), `shell/query-clear` (2 each), `shell/request-budget`, `shell/clinic-switcher`, `shell/back-resume-keyboard` (rewritten for the board read; 6 each),
  `pwa/11-refresh-outage-and-pin`: 91 passed, 15 skipped by design, 2 failed = `back-resume-keyboard` "visibilitychange on Today" (it counted an RSC refresh; fixed above, 20 of 20 pass). `pwa/05-cache-audit` + `observability/rum`: 29 passed, 1 skipped (after the RUM storage fix; 2 failed before it).
  `perf-latency` row `live.today.refresh`: passed (5 samples, 8 calls, depth 8).
- Not run: the full Vitest suite, the full e2e PR lane and the design projects (no markup changed; CI does).

## 09E-04 Live convergence: clinic versions, one signal per transaction, heartbeat, live badge

Branch `v2/phase-09e-caching-speed`. Migration `000123_clinic_versions`. No new dependency.

### What shipped

- **000123** (`supabase/migrations/000123_clinic_versions.sql`, pgTAP `clinic_versions.test.sql`, 107 tests):
  - `public.clinic_versions(tenant_id, domain, version, changed_at, last_xact)`: RLS on, one SELECT policy (`authz.member_tenant_ids()`), `GRANT SELECT` to `authenticated` only; four rows per clinic (backfilled, and created by an AFTER INSERT trigger on `tenants`).
  - `private.clinic_bump(uuid[], text)` (definer, `search_path=''`, no API grant): the once-per-transaction upsert (`ON CONFLICT ... WHERE last_xact IS DISTINCT FROM pg_current_xact_id()`), clinics in id order; one `private.today_signal_send(tenant, domain, version)` per clinic it raised, inside an error-swallowing block. A clinic with no `tenants` row (a delete in progress) gets no row and no FK error.
  - 13 statement-level `AFTER` trigger functions `private.cv_*` (definer, no API grant) and 22 triggers with transition tables (list below); the seven row-level `*_today_signal*` triggers and `private.today_signal()` are dropped; `private.today_signal_send` replaced (payload `{domain, version}`; topic and `today_signals_select` policy unchanged).
  - `visits.row_version`, `invoices.row_version` (`bigint NOT NULL DEFAULT 0`) with BEFORE INSERT OR UPDATE row triggers (`private.visits_row_version`, `private.invoices_row_version`, invoker): +1 only when a listed column changes; a written value is overridden (an insert always starts at 0).
  - `public.clinic_live_state(uuid)` (STABLE INVOKER, `search_path=''`, EXECUTE `authenticated` only): `{versions: {schedule, queue, billing, settings}, access}` from one statement; NULL for a non-member (the versions pass the table's RLS). `access` is `public.my_tenant_access`.
  - Bumped in the same commit (pattern of 1b90c947): `EXPECTED_MIGRATION`, schema snapshot, `types/database.ts`, `assert-pgtap-report.mjs` (REQUIRED_FILES + FLOOR 9291, measured 9291 in 71 files), `definer_functions.test.sql` (registry rows for the 15 new definer functions, the old `today_signal` row removed), the authz matrix (`clinic_versions` target, `authz:gen` regenerated `authz_matrix`, `authz_completeness`, `access_lock_rls` and `AUTHZ-MATRIX.md`; `scripts/gen-authz-pgtap.ts` lists `clinic_versions` among the tables a locked clinic's members still read).
- **Client** (`lib/live/`): `domains.ts` (domains, `parseSignal`, `parseSnapshot`), `live-core.ts` (pure, injected deps: heartbeat, checks, basis rule, coalescing, badge, metrics), `provider.tsx` (the shell's one channel `today:<tenant>`, opened while visible and closed 60 s after hidden; the `online` hook; the badge tick; the TanStack Query bridge: dependents are the queries with `meta.domains`, re-read = `invalidateQueries` of exactly that query with `cancelRefetch: false`, removal = `removeQueries`), `use-live-screen.ts`, `use-changed-elsewhere.ts` (the rule; the screens that show it are 09E-06), `server.ts` (`readLiveSnapshot`).
- **`GET /api/live/state`** (`app/api/live/state/route.ts`): any active member at any access level (`resolveServiceContext(undefined, "billing")`, like the RUM route), tenant from the session (a `tenant` parameter is ignored), `private, no-store`, `timedRoute`, fixed error bodies, no service-role client. Guard manifest kind `live-state` with legs (`liveStateRouteLegs`): 401, no membership 403, every role 200 with exactly `versions`+`access`, forged `tenant`/`tenantId` changes nothing, one `clinic_live_state` call.
- **Today**: registers as a live screen (`useTodayLive` is now `useLiveScreen` + `refreshNow`); its query carries `queryDomains.today` (queue, schedule, billing); the 20 s full-board poll and its own channel are gone; `LiveStatus` is replaced by `components/shell/live-badge.tsx` ("Live" / "Reconnecting · Updated N s ago", a dot and words, `data-live-status`); the page reads `clinic_live_state` BEFORE the board and hands the versions to the screen as the board's basis.
- **Resume** (`ResumeRefresh`): on `/today` it asks the live core for a check (one `GET /api/live/state`; the board is read again only when a version moved) instead of invalidating the board unconditionally; the schedule keeps its page refresh.
- **Lock path (D-8)**: `onAccessLevel(access)` in `lib/pwa/lock.ts`: any access other than `full` from a confirmed state read asks for a fresh status check (`requestSessionCheck("lock")`, throttled), which redirects and keeps the session.
- **RUM**: `live_reread` (ms from learning a newer version to the end of the re-read), `live_dropped` (a check found a version while SUBSCRIBED that no signal had delivered), `live_reconnect` (a rejoin after the first join).

### Which table, event and column moves which domain (every column listed or not)

A statement that touches no row, or an update whose compared columns are unchanged, moves nothing. "all" = any insert, update or delete of the row.

| Table | Event | Domains | Listed (moves) | Not listed (moves nothing) |
| --- | --- | --- | --- | --- |
| `visits` | insert | queue, schedule | all | |
| `visits` | update | queue, schedule | `status` | |
| `visits` | update | schedule | `scheduled_at`, `doctor_id`, `estimated_duration_minutes`, `is_overbooked`, `origin_type` | `created_at`, `created_by`, `current_revision`, `id`, `location_id`, `metadata`, `patient_id`, `reason_for_visit`, `signed_at`, `signed_by`, `specialty`, `tenant_id`, `updated_at`, `row_version` |
| `queue_tokens` | insert, update | queue | all | |
| `clinical_notes` | update | queue | `vitals` | `advice`, `chief_complaints`, `clinical_notes`, `created_at`, `draft_version`, `investigations_advised`, `specialty_data`, `tenant_id`, `updated_at`, `visit_id` |
| `invoices` | insert | billing | all | |
| `invoices` | update | billing | `status`, `total_amount` | `created_at`, `discount`, `id`, `invoice_number`, `location_id`, `patient_id`, `subtotal`, `tax`, `tenant_id`, `updated_at`, `visit_id`, `row_version` |
| `invoice_items` | insert, update, delete | billing | all | |
| `payments` | insert, update | billing | all | |
| `schedule_blocks`, `waitlist_entries` | insert, update, delete | schedule | all | |
| `memberships` | insert, delete | schedule, settings | all | |
| `memberships` | update | schedule, settings | `availability_schedule`, `default_slot_duration_minutes`, `role`, `status`, `full_name` | `created_at`, `default_specialty`, `id`, `medical_council_reg_no`, `phone`, `qualifications`, `removed_at`, `removed_by`, `signature_url`, `tenant_id`, `user_id` |
| `tenants` | update | settings | `name`, `timezone`, `rx_letterhead_mode`, `rx_paper_size`, `letterhead_top_margin`, `letterhead_bottom_margin`, `logo_url`, `address`, `phone`, `email`, `registration_number`, `clinical_establishment_reg_no`, `state_medical_council_reg_no`, `drug_license_no`, `gstin` | `accepted_payment_methods`, `created_at`, `default_consultation_fee`, `default_followup_fee`, `id`, `owner_is_practicing_doctor`, `referral_directory_listed`, `specialties`, `updated_at`, `working_hours` |

`row_version` (R-19) moves on: `visits.status`, `scheduled_at`, `doctor_id`, `estimated_duration_minutes`, `is_overbooked`, `origin_type`, `patient_id`, `signed_at`; `invoices.status`, `total_amount`, `subtotal`, `discount`, `tax`. (Not on `metadata`, `reason_for_visit`, `updated_at`, `signed_by`, reminder columns.) `patient_id` and the sign-off columns cannot be changed by a plain write (immutability and sign-off guards), so their branches are covered by the listing, not by a SQL test.

### Fails-without

- **High, a bulk change exhausting the Realtime quota** (recorded in a scratch transaction on the local stack, rolled back; the migration was not edited): the old row-level trigger (000102's `today_signal` shape, restored on `visits` inside the scratch transaction) with 20 visits inserted in one statement writes **20** messages to `realtime.messages`; the committed design (statement trigger, `private.clinic_bump`) writes **2** for the same 20 visits (queue, schedule). The pgTAP case (`clinic_versions.test.sql`, 20 visits of A and 3 of B in one transaction: exactly 4 messages, one per clinic and domain) fails against the old shape for the same reason. Not committed as a file (a scratch SQL in the session scratchpad).
- **High, silent staleness** (`tests/e2e/live/convergence.spec.ts` "dropped", desktop-chrome): with the heartbeat's interval removed in `live-core.ts` (`beat = () => undefined`), the build rebuilt, and the case's clock advance raised to 60 s (a scratch copy of the spec, deleted), A's row never appears: the test fails on the visibility assertion after 60 s of clock time. Restored (diff against the saved original empty), rebuilt; the committed spec passes with the 12 s heartbeat.

### Decisions and deviations

- **No `profiles` table exists in this schema**: the plan's `profiles` trigger (display-name columns, settings of every clinic of the user) has nothing to attach to. The display name is `memberships.full_name`, which is listed (schedule + settings). If a profile table arrives later, its trigger needs a migration of its own.
- **`invoices` signal columns**: `status` and `total_amount` signal; `discount`, `tax`, `subtotal` do not (a change of them changes the total in the same statement in every command today). `row_version` moves on all five (plan: "status, total_amount, the discount, tax and paid-total columns"; there is no paid-total column on `invoices`, the paid total is derived from `payments`, which signal billing).
- **`tenants` "settings columns the bootstrap shows"**: listed = name, timezone, the Rx print and letterhead columns (`rx_letterhead_mode`, `rx_paper_size`, `letterhead_top_margin`, `letterhead_bottom_margin`, `logo_url`) and the letterhead identity columns (`address`, `phone`, `email`, the registration numbers, `drug_license_no`, `gstin`). Fees, specialties, payment methods and `working_hours` are not (R-13: "fees: read with the bill"). The list is a PO call if the bootstrap (09E-13) shows more.
- **`clinic_versions` SELECT policy is `authz.member_tenant_ids()`** (active member of the clinic, any access level, any of the user's clinics), as the plan says. Consequence: a dual member acting in clinic B can read clinic A's version numbers (no PHI), like `tenants`; `tests/authz/table-matrix.spec.ts` lists it with the switcher's tenants row (R-42 tests), and a locked clinic's members still read it on purpose, so `clinic_live_state` can report `access ≠ full` to a locked device (`access_lock_rls` expectation updated). Tightening it to the active clinic needs a new matrix rule kind: PO call.
- **Deadlock note (research 2.2 cost, now measured as a risk)**: a transaction holds each version row it bumped until commit. Two transactions that bump different domains of one clinic in opposite orders across their statements can deadlock (PostgreSQL aborts one with 40P01). Inside one statement the order is fixed (clinics by id, domains alphabetical: billing, queue, schedule, settings); across statements of one transaction it is the order of the statements. No command in the tree was found to do it (the commands write visits then queue then invoices in one direction), but 09E-07's stale-write commands and bulk jobs must keep that order or chunk.
- **The page's basis costs no call**: `getTenantTimeZoneAndVersions` reads the zone and the clinic's `clinic_versions` rows embedded in the same `tenants` statement (PostgREST embed through the foreign key), and the Today page calls it BEFORE the board (`getTodayBoard` takes the zone as an option, so its own zone read is skipped): the versions are a lower bound of what the board holds and the page makes the same number of calls as before. Embed on a user-JWT client only (service_role has no grant on `clinic_versions`). If the embed fails the zone is read alone (never a wrong zone because of the versions) and the screen gets no basis (one extra re-read).
- **A hydrated query's basis is set once**: `setBasis` only fills a query that has none; a later page render (after a Server Action's `revalidatePath`) never raises it, because the cache may have kept the newer data. The cost is at most one extra re-read after an own write.
- **The check on SUBSCRIBED asks only when a live screen is registered or a query with domains is shown** (the plan: "an immediate check on SUBSCRIBED"): a page of another kind (Schedule, the consult, Patients) would pay one `GET /api/live/state` for nothing, and the PR-blocking `in-app.*` rows of those pages caught exactly that (+1 call). Today and the first live screen to register are unchanged. The visible, `online`, resume and heartbeat checks are as in the plan.
- **Resume on Today is a check, not a board read**: `ResumeRefresh` calls `live.wake()` (one state call; the board is read when a version moved) where 09E-03 invalidated the board unconditionally. `tests/e2e/shell/back-resume-keyboard.spec.ts` and the `live.today.refresh` row were rewritten for it (the row changes the database through psql, not Kong, so the change is no call of the window; its ceiling falls from 8 calls and depth 8 to 5 and 5 through `scripts/perf/latency-ceilings.mjs`, the tool also re-pointed every row's `source` at the merged evidence file `evidence/09E-04/live-today-refresh-300ms.json`: the other rows' numbers are unchanged).
- **`LiveProvider` sits in `app/(dashboard)/layout.tsx` inside `QueryProvider`**, not in `app-shell.tsx` as the plan's file list says: it needs the query client, which the layout provides inside the shell. `app-shell.tsx` needed no change (resume and `online` are handled by `LiveProvider` and `ResumeRefresh`).
- **`use-changed-elsewhere.ts`** is delivered as the rule (flag when a seen version of a domain passes the baseline: the page's versions, or the first confirmed versions after mount); no screen shows it yet (09E-06).
- **Fixed on the way (09E-02's miss)**: `tests/ops/ops-cleanup-db.spec.ts` expected the nine counts of `ops.cleanup()` before 000122 added `rum_daily` and `rum_overflow`; it failed in the full Vitest run. Two more files failed in that run for the machine, not the code: `tests/ops/backup-roundtrip-db.spec.ts` and `restore-guards.spec.ts` need the `age` binary (`ops/bin/install-age.sh`), which this VM does not have.
- `assert-vitest-report.mjs`: REQUIRED_FILES loses `tests/today/live.spec.ts` (replaced) and gains `tests/live/live-core.spec.ts` and `tests/live/tenant-zone-and-versions.spec.ts`; the FLOOR (6455) is unchanged, to be re-measured at the phase gate. The pgTAP floor is 9291.
- `lib/observability/server-routes.ts` regenerated (`/api/live/state`, kind route).

### Security-sensitive for the adversarial review

`supabase/migrations/000123_clinic_versions.sql` (definer functions `private.clinic_bump`, `private.cv_*`, `private.clinic_versions_seed`, replaced `private.today_signal_send`; their `search_path`, the absence of any API grant, the transition-table triggers, deletion of a clinic through the cascade; the `clinic_versions` RLS and grant; `clinic_live_state` INVOKER and its NULL for non-members; the BEFORE triggers that override a written `row_version`), `app/api/live/state/route.ts` and its guard kind `live-state` (`tests/security/guard-manifest.ts`, `guard/engine.ts`), `lib/datetime/server.ts` (`getTenantTimeZoneAndVersions`: the embed under RLS), `lib/pwa/lock.ts` (`onAccessLevel`), the authz matrix change (`tests/authz/table-matrix.ts`, `scripts/gen-authz-pgtap.ts`), and the dropped `{kind, visit_id}` payload (a signal is `{domain, version}`: no id, no name, no number; the topic policy `today_signals_select` and `authz.today_topic_allowed` are untouched).

### For the PO

- **Budget rows (blocking `@budget` step of the latency lane)**: after the last change all six `@budget` rows and `live.today.refresh` pass against the unchanged ceilings (`perf-latency --grep "@budget|live.today.refresh"`: 14 passed). Before the two fixes above, five of the six failed by +1 call (the shell's check on every page) and the Today page's separate version read (+1 call, +1 depth): both were removed rather than the ceilings raised. `save.R.check-in` passed in that last run, but it failed 4 times out of 4 earlier with `visits` read twice (the page's re-render after the action plus the board read the own signal causes): that second read is 09E-03's design (a board GET instead of an RSC refresh) and 09E-08's `revalidatePath` removal is its owner; its pass in the last run is timing luck, not a fix. If it flakes in CI, the ceiling is the PO's call.
- Whether `clinic_versions` should be readable only for the active clinic (above), and whether the dual-member read of another clinic's version numbers matters.
- `live_dropped` counts a check that finds a version while SUBSCRIBED that no signal delivered; a signal still in flight when the check returns counts too (a false drop, one per race). If the staging number looks high, the definition needs a 2 s grace.

### Tests run (local stack)

- `npm run typecheck`: clean. `npx eslint .`: 0 errors (390 warnings, unchanged). `npm run inventory`: 0 flagged (37 route modules, 59 methods). `node scripts/observability/server-routes.mjs --check`, `node scripts/drift/schema-snapshot.mjs --local --check`: pass.
- pgTAP (after `db reset --local`): 9291 tests in 71 files, 0 failed, gate PASS at floor 9291 (`clinic_versions.test.sql` 107 of 107; `today_signals` 31, `front_desk_review_fixes` 54, `definer_functions` 109, the three regenerated authz files). A first pgTAP run after the e2e and Vitest runs on the same database failed 5 files on leftover rows (a `smart_assist` timing at 10,000 patients, four files that need an empty table); a reset cured it, as in CI.
- Vitest: the whole suite once: 412 files, 8228 tests; 8227 passed, 1 failed (`ops-cleanup-db`, fixed above), 2 files not run (`age` missing). Affected files re-run after the fix: `tests/live` (33: live core 30, zone and versions 3), `tests/realtime/today-signals.spec.ts` (12: payload keys of the signals, a 50-row insert delivers one signal per domain, two transactions raise by two, nothing for another clinic, the 09C quota wait kept), `tests/authz` (44), `tests/security/guard-routes.spec.ts` live-state leg, `tests/today`.
- e2e, final tree (`stack:recycle` before, `--retries=0`, desktop-chrome, pixel-7 and iphone-15 as each spec's lane allows): `live/convergence` (4 cases: delivered, dropped, refused socket, hidden tab; the first two are `@golden` and run on iphone-15), `today/*` (today-live 5, front-desk, review-fixes), `a11y/live-badge` (3 widths: 360, 820, 1280; the badge's three states), `shell/query-clear`, `shell/request-budget`, `shell/clinic-switcher`, `shell/back-resume-keyboard` (rewritten), `pwa/05-cache-audit`, `pwa/11-refresh-outage-and-pin`, `observability/rum`: **142 passed, 0 failed, 19 skipped by design** (12.6 min).
- `perf-latency --grep "@budget|live.today.refresh" --retries=0`: 14 passed (8 setup + 6 `@budget` rows; `live.today.refresh` 5 calls, depth 5, now the ceiling).
- **Open: one unexplained e2e failure.** In one earlier combined run (`live` + `back-resume-keyboard`, three projects) `convergence` "delivered" failed on iphone-15 (30.5 s; the error text was lost because the run's output was filtered). It was not reproduced: the same case passed 5 of 5 with `--repeat-each=5`, in two full three-project sequences after a stack recycle (18 and 30 of 30), and in the final run. Candidates: WebKit's first Realtime join after a recycle taking longer than the 20 s badge wait, or the 2 s delivery window. Not root-caused; to be watched in CI (a retried pass there is a defect).
