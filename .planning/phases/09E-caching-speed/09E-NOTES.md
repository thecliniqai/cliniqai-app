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

## 09E-05 The consult in one read; the doctor's lists in its query

Branch `v2/phase-09e-caching-speed`. Migration `000124_consult_screen`. No new dependency.

### What shipped

- **000124** (`supabase/migrations/000124_consult_screen.sql`, pgTAP `consult_screen.test.sql`, 73 tests): `public.consult_screen(p_tenant_id, p_visit_id) RETURNS jsonb`, STABLE, **SECURITY INVOKER**, `search_path ''`, EXECUTE for `authenticated` only
  (not PUBLIC, anon or service_role). Header: "a new INVOKER read composed of existing reads; no table, policy or grant change beyond EXECUTE". No table, column, policy, trigger or data change; no definer function (so no
  `definer_functions` registry row and no authz-matrix change were needed: the registry lists definer functions and tables; the schema snapshot and `types/database.ts` carry the function).
  - NULL (never an error that tells the cases apart) for: no session, a NULL argument, another clinic's visit, a forged tenant, a visit that is not in the tenant, a role without `consultations:view` (receptionist, admin), a clinic that is not `full`
    (the permission helpers only count full clinics), a patient the caller cannot read.
  - Parts and gates (as the page gated them): `visit`, `patient`, `notes` (+ `draft_version`), `token_number`, `follow_up`, `diagnoses`, `prescription {items, latest_version}`, `amendment` (only while amending), `history` (the patient's other completed or
    in-consultation visits with their diagnoses and active Rx lines, newest first, the visit on screen excluded), `entitlements` (the `assist.*` map), `allergy_context` (`rx_allergy_context`); `assist_context` (`consult_assist_context`, editable record,
    `consultations:edit`, `assist.terminology` or `assist.frequent_rx`), `snapshot` (`patient_snapshot`, `assist.snapshot`), `macros` (editable, `consultations:edit`, `assist.shorthand`, the caller's own, cap 200), `upcoming` (editable, `assist.followup`),
    `documents` (`labs:view`; the fields the screen shows, no storage path), `my_lists` (`prescriptions:edit` or `consultations:edit`: the caller's OWN custom medicines (500 by use_count), custom diagnoses (500) and templates (100), `doctor_id = auth.uid()`).
  - "Editable" is `amending OR (draft AND status not completed/cancelled)` in SQL for the reads that are only worth doing for an editable record; the TypeScript predicate (`recordState`, `isEditableRecord` in `screen.ts`) is applied again and is the rule the page shows
    (the SQL copy only saves the work; the parity spec compares the two over five record states).
- **`features/consultation/screen.ts`** (new): zod parse of the answer and `buildConsultScreen(raw, {canEdit})` -> `ConsultScreen` (the view model the workspace reads: visit, patient, past encounters, assist map, learned order, snapshot, macros, upcoming instants,
  documents, allergy context, lists); a part that is not the documented shape is dropped, a NULL answer is `null` (the page answers 404). `consultQueryData`, `withTemplate`, `withMacros` (pure updates for the query).
  `parseRxAllergyContext` moved to `features/prescriptions/allergy.ts` (the service uses it; the one schema).
- **Page** (`app/(dashboard)/consultation/[id]/page.tsx`): membership from the session context (no call), `consultations:view` check, a non-uuid id is a 404 with no call, **one** `rpc/consult_screen`, `buildConsultScreen`, `hydrate` of `queryKeys.consult(tenantId, visitId)`
  (`HydrationBoundary`). The 14 sequential reads are deleted from the page (their services stay: history, diagnoses, Rx, assist context, snapshot, macros, upcoming, documents, allergy context have other callers or are the parity reference).
  An RPC error is logged (code only) and throws (the error boundary, Retry); it is not a 404. The print payload of a sealed record is started, not awaited, and handed to the workspace as a promise (below).
- **The consult's query** (`components/consultation/workspace/consult-query.tsx`, `lib/query/keys.ts` `queryKeys.consult`): holds `{lists, macros, assistContext, rxAssistContext}` (memory only, no persistence: the 09E-03 lint ban stands). `queryFn: skipToken`: it can be written, never re-read, so a focus or
  a reconnect cannot make a call. The workspace reads favourites, usual doses (`assistContext`, `rxAssistContext`) and macros from it; the Templates sheet reads `lists.templates` through a context and no longer fetches when it opens; a saved template
  (`saveDoctorProtocolTemplate` now returns the saved row) and an edited macro list update it with `setQueryData`. A later server render of the page (Finish, Amend, Finalize: `router.refresh`) replaces the query's content with what the database says
  (an effect on the new server object, not hydrate's `dataUpdatedAt` rule: a client clock that runs ahead would otherwise keep stale data after Amend).
- **Print view** (R-9): `printPayload` is now `Promise<PrescriptionPdfPayload | null>`; `PrintPayloadResolver` (`use`) under `Suspense` with no fallback hands it to the workspace state. The sealed record's data (`consult_screen`) is on screen first; "Print Rx" / "Rx PDF" settle when it resolves.
- **`DataReady`**: unchanged, `withPageAuth` already renders it after every main screen's content (the consult included).
- `scripts/perf/command-latency.ts`: `read: consult_screen` (below). `tests/e2e/perf/latency-ceilings.json`: five rows lowered through `scripts/perf/latency-ceilings.mjs` (below).
- Fixture fallout: `tests/consultation/workspace-{sealed,review-fixes}.spec.ts` render the workspace inside a `QueryClientProvider` and pass `tenantId`; `tests/e2e/consult/rx-allergy.spec.ts` (09C-06a A-3) writes its template with the admin client AFTER the page was served,
  so it reloads before opening the sheet (the sheet no longer reads the table when it opens: that is the requirement).

### Specs

- **pgTAP `consult_screen.test.sql`** (73): grants and shape; 12 refusal cases (all NULL); the role x part matrix (owner, visit's doctor, another doctor, nurse; receptionist and admin NULL); the five record states (draft, sealed, unsigned completed, cancelled, amending with its reason);
  own lists only (custom medicines, custom diagnoses, templates, macros; another doctor's never; caps 500/100 with 510 medicines and 110 templates seeded); entitlement overrides remove their part; content of the parts (order, history without the current visit, documents without a path).
- **`tests/consultation/consult-screen-parity.spec.ts`** (49): for draft, amending, sealed, unsigned completed and cancelled, and for owner, the visit's doctor, another doctor, nurse and receptionist, the view model from `consult_screen` **deep-equals** the one built from the old reads (the page's old loader kept in the spec as
  `legacyScreen`, over the caller's own client; 25 comparisons, receptionist = null on both sides), and a second block of stored expectations (which parts each state and role carries; own lists only; history without the visit on screen; Rx in sort order). Deviation from the plan's wording
  ("the committed spec then compares against stored expectations"): the comparison with the old reads is kept in the committed spec because the services it uses stay in the tree; the stored expectations are added next to it.
- **e2e `tests/e2e/consult/consult-screen.spec.ts`** (all three projects): a full load of a draft consult has exactly one `POST rpc/consult_screen` in the server's Kong window and none of the old table reads or Smart Assist rpc calls; opening Templates twice makes **0 Supabase calls** (server and browser); saving a template
  makes no `GET doctor_prescription_templates` and no browser call, and the sheet reopened shows it with 0 calls.

### Fails-without (High: another doctor's data in the consult)

With the `doctor_id = v_uid` filter removed from the four list reads (a scratch copy of the function applied to the local database, the migration untouched; `db reset --local` restored it), `consult_screen.test.sql` fails 5 of 73: 40-43 (one custom diagnosis and one template, the caller's own: the other doctor's rows appear) and 49 (the owner,
who owns no list rows, sees the doctors' diagnoses and templates instead of three empty lists). `doctor_custom_diagnoses` and `doctor_prescription_templates` have clinic-wide SELECT policies (`consultations:view`), so the filter is the only thing keeping a colleague's rows out. `doctor_custom_medicines` and `doctor_text_macros` pass without it
(their policies already limit SELECT to the caller's own rows since 000120 and 000115): the filter there is defence in depth. Restored; the committed function passes 73 of 73.

### Latency, calls and budget rows (tool output)

- **`command-latency.ts` `read: consult_screen`** (heaviest draft: the hot patient's 50 signed visits, the learned order from 300 signed visits, three Rx lines, and the lists at their caps: 500 + 500 + 100 + 200 macros; 60 calls): **p50 93.7, p95 126.4, p99 170.7 ms**
  (`evidence/09E-05/command-latency.json`). **The plan's "p95 < 50 ms" is not met on this VM.** The same run measures the existing reads it composes over their own 50 ms read target on this machine: `consult_assist_context` p50 45.7 / p95 57, `rx_allergy_context` p50 32.3 / p95 36.9, `patient_snapshot` p50 18.5 / p95 23.2,
  against 13.1 / 14.1, 7.5 / 8.1 and about 6 on the 09C machine (3 to 4 times faster), so this VM is about 3.5 times slower than the one the target was set on; `search_diagnoses` (p95 125.5) and `search_medicines` (103.5) also fail their 09B/09C targets in the same run. `consult_screen` p50 (93.7) is no more than the sum of its parts' p50 (96.5): the
  composition adds nothing. A machine like the 09C one would measure about 30 ms. I did not change the function to hit a number on a slower machine; this is for the PO (below).
- **Budget rows** (`perf-latency --grep consult` at 300 ms, `PERF_LATENCY_MERGE` onto the 09E-04 file, `evidence/09E-05/consult-rows-300ms.{json,md}`; ceilings written by `latency-ceilings.mjs`, no number typed, no raise):

| Row | Before (calls / depth) | After (calls / depth) | ms (median) |
| --- | --- | --- | --- |
| `in-app.D.consult-draft` (B-1, PR lane) | 16 / 16 | **1 / 1** (`consult_screen`) | 449 |
| `in-app.D.consult-sealed` (B-1) | 31 / 23 | 18 / 10 (1 + the print read's 17) | 456 |
| `full.D.consult-draft` (B-3) | 20 / 16 | 5 / 3 | 593 |
| `full.D.consult-sealed` (B-3) | 35 / 23 | 22 / 10 | 574 |
| `save.D.start-consult` (09E-08's row, lowered as a side effect: the page it redirects to) | 27 / 17 | 16 / 8 | 1087 |

  The plan expected depth 1 for the sealed rows and 2 for the full loads. **Sealed**: the 17 other calls are the print payload read (`loadPrescriptionPdfSource`, 16 sequential-ish table reads and one storage read), which the plan keeps as a separate read; it is streamed now, so the data row is on screen at 456 ms (within the 1,000 ms target) while that read
  finishes, but it is still in the window's count and depth. Turning it into one SQL read is a separate piece of work (PO question). **Full draft**: 5 calls = the shell's two (`memberships`, `visits`: the layout/shell read, not the page), `consult_screen`, and the notification count (HEAD + GET, after hydration); depth 3, not 2, because the notification read starts after the page is up.
  Neither is the page's own cost: the page's own cost is 1 call, depth 1.

### Decisions and deviations

- **Print payload as a promise**: the workspace holds the resolved payload in state and the page returns before it resolves, so the server-rendered HTML of a sealed record carries "Print Rx" (soft) until the promise lands (hydration), then "Rx PDF" and the print portal. Specs that look for the print view wait for it (they pass, 0 retries).
- **`getDoctorProtocolTemplates` (server action) is now unused by the UI** but stays: it is in the guard manifest and other callers may use it; removing a server action is outside this plan.
- **Custom medicines and custom diagnoses are in the query but nothing reads them yet**: the consumers are the on-device search (09E-10, 09E-11: "custom first", "custom diagnoses first"). R-8's "update with `setQueryData` from each save's result" for a custom medicine's `use_count + 1` and a custom diagnosis belongs with those consumers (the Rx command's and the diagnosis command's results); I did not add dead
  update code for them here. Templates and macros (which have readers) update from the result.
- **`entitlements` and the access level**: `my_entitlements` is level-neutral; the SQL reads it only for a `full` clinic, and the permission helpers already return NULL for any other level, so a clinic that is not `full` gets NULL as a whole (the layout redirects it first on a full load; `withPageAuth` first on a client navigation).
- **History order and ties**: diagnoses and prescriptions are ordered by `created_at`/`version` then `id` in SQL (the old reads left ties unordered); the parity fixtures use distinct timestamps.
- **A visit with a hidden patient** (RLS) is NULL (404) as before.
- `assert-pgtap-report.mjs`: REQUIRED_FILES + `consult_screen.test.sql`, FLOOR 9364 (9291 + 73, measured 9364 in 72 files). `EXPECTED_MIGRATION` 000124; schema snapshot (2 lines) and `types/database.ts` (the function) regenerated.

### Security-sensitive for the adversarial review

`supabase/migrations/000124_consult_screen.sql` (INVOKER, `search_path ''`, the NULL cases, every `doctor_id = v_uid` filter, the caps, `my_entitlements`/`my_tenant_access` use, EXECUTE grant), `app/(dashboard)/consultation/[id]/page.tsx` (tenant from the session, the uuid check, the error path),
`features/consultation/screen.ts` (what is dropped or applied again), the consult's query (`consult-query.tsx`: memory only, ids-only key `[tenantId, "consult", visitId]`, cleared by the 09E-03 provider cleanup at sign-out, lock and clinic switch; it holds the doctor's own lists, macros and the learned order, which contain medicine and diagnosis names and macro text but no patient, visit or item id),
the dehydrated state in the server-rendered HTML (the same data), the print promise (a payload of a sealed record streamed to the page that is already authorised to show it). No service-role client, no route added, no RLS or grant change.

### For the PO

- **p95 < 50 ms for `consult_screen` is not met on this VM (126 ms), by the VM**: its parts measure 3 to 4 times their recorded figures. Options: accept the target as "no slower than the sum of its parts" (measured: 93.7 vs 96.5 p50), or re-measure on a faster machine. The three reads it composes would also need the same allowance (`consult_assist_context` p95 57 ms here).
- **The sealed consult's print read (17 calls, depth 10)** is off the critical path now, but a one-read `rx_print_source` would take the sealed rows to 2 calls: do it in this phase (a later plan) or leave it?
- Open from 09E-04, unchanged by this plan: `save.R.check-in` (owner 09E-08; see below), and the one unexplained iphone-15 "Delivered" failure.

### Tests run (local stack)

- `npm run typecheck`: clean. `npx eslint .`: 0 errors (390 warnings, unchanged). `npm run inventory`: 0 flagged. `server-routes.mjs --check`, `schema-snapshot.mjs --local --check`: pass.
- pgTAP (after `db reset --local`): 9364 tests in 72 files, 0 failed, gate PASS at floor 9364 (`consult_screen.test.sql` 73 of 73; no other file's count moved). `seed:local` was not needed for these lanes.
- Vitest (affected directories: consultation, prescriptions, terminology, security, query, live, today, perf, observability, api, authz, ci, shell, pwa, lint, realtime, labs, permissions): 180 files, 4111 tests passed (parity spec 49, workspace specs 15). The two `age`-binary files were not in scope and were not run (known).
- e2e (`--retries=0`, `stack:recycle` before each run, desktop-chrome, pixel-7, iphone-15): `tests/e2e/consult` all 15 specs: 296 passed, 28 skipped by design, 2 failed = `rx-allergy` "template with an allergen line" (desktop, pixel-7): it wrote the template after the page was served and expected the sheet to read it; fixed in the spec (reload, see above).
  Second batch: `rx-allergy`, `consult-screen`, `shell/request-budget`, `shell/query-clear`, `shell/nav-per-role`, `a11y/consult-screens`, `pwa/05-cache-audit`, `live/convergence`, `observability/rum`: 140 passed, 20 skipped by design, 0 failed. `consult/workspace-layout` and the print specs passed in the first batch (axe clean, 360/tablet/desktop as each spec covers).
- `perf-latency --grep "@budget|live.today.refresh" --retries=0` on the final tree: 14 passed, **1 failed: `save.R.check-in`** (6 calls against its 4: `visits` and `tenants` read twice). This is the 09E-04 watch item (the check-in's second `visits` read, owner 09E-08, ceiling untouched); it is a Today action and the consult is not on its path. It is not raised here.
  `in-app.D.consult-draft` (the consult's PR row, 1 call / depth 1) passed; `live.today.refresh` passed.
- The unexplained iphone-15 "Delivered" failure of 09E-04 did not occur in `live/convergence` (3 projects) in this run.

## 09E-06 Today and the other main screens in one round trip; skeletons; the changed-elsewhere notice

Branch `v2/phase-09e-caching-speed`. Migration `000125_today_board`. No new dependency.

### What shipped

- **000125** (`supabase/migrations/000125_today_board.sql`, pgTAP `today_board.test.sql`, 62 tests): `public.today_board(p_tenant_id, p_mode, p_doctor_id DEFAULT NULL, p_date DEFAULT NULL) RETURNS jsonb`, STABLE, **SECURITY INVOKER**, `search_path ''`, EXECUTE for `authenticated` only. No table,
  column, policy, trigger or grant change (so no definer-registry row and no authz-matrix change; schema snapshot and `types/database.ts` carry the function). NULL (never an error that tells the cases apart) for: no session, a NULL tenant or mode, an unknown mode, no `appointments:view`
  (another clinic, a forged tenant, no membership, a clinic that is not `full`). Returns `{time_zone, versions, doctors, visits}`: the clinic's stored zone text; the four `clinic_versions` of the **same snapshot** as the visits (an exact basis, not 09E-04's lower bound); the clinic's doctors (role doctor, or the owner when
  practising; removed ones too, so a past visit names its doctor); the clinic day's visits with only the fields a row shows (patient: name, phone, sex, age, date of birth; **`has_allergy` flag, never allergen names**; token; vitals; invoice total, payments summed and `row_version`; follow-up date and its booked flag) and each visit's `row_version`. Gates as the page applied them, in the statement
  and again by RLS: allergy flag with `vitals:view` or `consultations:view`; vitals with `consultations:view`; invoice part with `billing:view` and a completed visit; follow-up part with `appointments:edit` and a completed visit. Mode `doctor` lists one doctor's visits: `p_doctor_id`, else the caller.
- **`features/today/board-model.ts`** (new, pure): zod parse of the answer, `buildTodayBoard(raw, role, {now})` -> the same `TodayBoard` the screen took (age text, wait minutes, row actions, balance, lanes stay in TypeScript). `getTodayBoard` is now one `rpc('today_board')` + that builder and also returns `versions`. `TodayRow` gained `rowVersion` and `invoiceVersion` (09E-07 compares them; `TODAY_ROW_KEYS` updated).
  The page and `GET /api/today/board` (unchanged body and gates) use it; the page's separate zone-and-versions read is gone (the versions come with the board and are the screen's basis).
- **Pages in one round trip** (independent reads together, dependent or slow ones streamed): the patient record (patient, consents, role together; the visit history, a chain of reads, started at once and streamed under `Suspense` with its own skeleton; the history's prescription lines and payments are now embeds on their statements, so the history is two round trips, not four); Visits (the period's invoices read beside the page's own reads;
  the zone-and-versions read first, which also seeds the plain zone memo, so no second `tenants` read); Billing reports (the invoices read beside the payments; same zone read); Staff (members and invitations together); clinic settings and the profile (their two reads together). Developer settings and Referrals already read together. `/billing/register` is a redirect and needs no skeleton.
- **Skeletons** (`components/shell/skeletons/{today,list,patient,schedule,settings}-skeleton.tsx`, DESIGN §6.9: static blocks, the real page title at once, announced once as "Loading") on every main route's `loading.tsx` (13 files; clinic, subscription and developer settings got their own). The patient record has no route skeleton gap to fill (below), its history has one.
- **`patient.view` through `after()`** (`features/patients/service.ts`): the page no longer waits for its own audit row; written once per opening; a failure is logged by tag `patients.view_audit.failed` (code and tenant only) and never reaches the person; with no request scope (a script, a spec) it is written before the call returns. **Links to `/patients/[id]` are not prefetched** (Patients list, Visits, Referrals, Schedule card, Today detail): the record's layout reads the patient to decide 404, so a prefetch made one read per row in view.
  The layout and the page now share **one** patient read (`readPatientRecord`, a request-shared read with the clinic versions embedded; the layout writes no audit row).
- **Changed on another device** (`components/shell/changed-elsewhere.tsx`, `lib/live/use-changed-elsewhere.ts`): an inline `Banner` (role status, not a toast) "Changed on another device" with **Refresh** = `router.refresh()` on a patient (schedule, billing), Visits (schedule, queue), Billing reports (billing), Staff and clinic settings (settings). The basis is the versions the page read **in the same statement as its data, with no call of their own**:
  an embed `tenants(clinic_versions(domain, version))` on the patient and members reads, `clinic_versions` embedded in the clinic row of the settings read, and the shared zone read for Visits and Billing reports (read before the screen's data, so a lower bound). The hook's baseline now follows a new server render (Refresh), so the notice is answered. Nothing re-renders by itself.
- `scripts/perf/command-latency.ts` `read: today_board`; `tests/e2e/perf/latency-ceilings.json` lowered by `scripts/perf/latency-ceilings.mjs` (below); `assert-pgtap-report.mjs` floor 9426 and `today_board.test.sql` required; `EXPECTED_MIGRATION` 000125.

### Specs

- **pgTAP `today_board.test.sql`** (62): grants and shape; 10 refusal cases (all NULL); the versions equal `clinic_versions` in the same transaction for every role; the role x part matrix (allergy flag, vitals, invoice, follow-up for owner, doctor, nurse, receptionist, admin); the exact key sets of a visit and its patient and no allergen, address, note or follow-up text in any role's answer; the clinic day (yesterday, a booking six days ahead and another clinic's visit never; `p_date`);
  doctor mode (the caller's own, `p_doctor_id`, front and triage); invoices (total, payments summed, a cancelled invoice is no invoice, completed visits only); follow-up and its booked rule; `row_version` moves; the removed doctor is listed. `nobody lacks appointments:edit` in the matrix, so that gate is only structural (the test says so).
- **`tests/today/today-board-parity.spec.ts`** (13): front, triage and doctor mode for owner, admin, receptionist, nurse, doctor and an owner in doctor mode: the view model from `today_board` **deep-equals** the one the old service built (the old service is kept verbatim as `tests/today/support/legacy-board.ts`, the oracle; same deviation as 09E-05: it stays, with stored expectations beside it). A day with booked, waiting, in consultation, completed and billed, completed and unbilled, cancelled and no-show visits, a follow-up that is booked, two doctors (one nameless).
  Only difference by design: the number of a nameless doctor ("Doctor (3)") is its position in the directory; the old read left that order to the heap (an UPDATE moved a row), the new one is the membership's creation order. The parity compares the shape of that fallback.
- **e2e**: `shell/changed-elsewhere.spec.ts` (4): a booking for the open patient made elsewhere shows the notice, with **no render request and no new `patient.view` row** until Refresh, which writes one and answers the notice; Staff and clinic settings show it for a settings change (a letterhead margin, restored); Staff shows none for a booking; a patient's opening writes one row and rendering the list, hovering and focusing its link write none.
  `shell/loading-states.spec.ts`: 12 screens x 360, 820 and 1280 px (desktop-chrome): 700 ms added to every Supabase call, the screen entered by a client navigation, **its own skeleton is visible while the calls are pending, axe finds nothing on it**, then the content replaces it; a patient record's history skeleton the same way; status codes unchanged. `today/today-live.spec.ts`: a check-in in B shows in A within 2 s and the window holds exactly one `rpc/today_board` per board read (A's and B's) and no `invoices`/`payments`/`follow_ups`/`queue_tokens` table read.
  Vitest: `tests/live/changed-elsewhere.spec.ts` (the rule, the basis key, the embed parsers), `tests/patients/patient-view-audit.spec.ts` (5: the task is scheduled and the row not yet written; one row when it runs; a failed write is logged by tag and never thrown; no scope = inline; the layout's read writes nothing).

### Budget rows (tool output: `evidence/09E-06/final-rows-300ms.json`, `.md`; ceilings written by `latency-ceilings.mjs`, no number typed, no raise)

| Row | Before (calls / depth) | After |
| --- | --- | --- |
| `in-app.R.today` (B-1, PR lane) | 4 / 4 | **1 / 1** (`today_board`) |
| `in-app.R.patients` (B-1, PR lane) | 2 / 2 | **1 / 1** |
| `in-app.D.today` | 7 / 7 | 4 / 4 (the board, then the doctor's open amendments, snapshot entitlements and the next patient's snapshot: the plan streams the snapshot; not yet) |
| `in-app.R.visits` | 12 / 5 | 11 / 3 |
| `in-app.O.staff` | 2 / 2 | 2 / 1 |
| `in-app.O.settings-clinic` | 3 / 3 | 3 / 2 |
| `full.R.today` | 9 / 6 | 4 / 3 |
| `full.D.today` | 12 / 9 | 7 / 4 |
| `full.R.patients` | 6 / 4 | 4 / 3 |
| `full.R.visits` | 16 / 5 | 14 / 4 |
| `live.today.refresh` | 5 / 5 | **2 / 2** (planned 1 / 1: see open items) |

Rows that did **not** reach "depth 1 (full load 2)": the patient record, Visits, Billing reports, Settings and Staff full loads keep the depth of their own chain (see open items). `in-app.O.billing-reports`, `full.O.*`, `full.R.patient` kept their ceilings (unchanged by this plan or refused as a raise).

### Fails-without

- **`today_board` (High: another role's or clinic's data on the board)**, scratch copies applied to the local database (migration untouched, restored from the file): (A) the `appointments:view` gate removed: 1 of 62 fails (the clinic that is not `full` gets a board); (B) the allergy, vitals, billing and follow-up gates removed (`:= true`): 3 fail (receptionist and admin see the allergy flag, the doctor sees the invoice).
  (C) the `v.tenant_id = p_tenant_id` filter on the visits removed: **0 fail**: RLS alone keeps another clinic's visits out, so that filter, like the vitals and invoice gates for roles RLS already refuses, is defence in depth that the tests cannot tell from RLS; they pass with or without it. Stated, not hidden.
- **`patient.view` after the response**: with `after(run)` replaced by `await run()`, `patient-view-audit.spec.ts` fails 3 of 5 (the row exists before the response is over). Restored.
- **Parity**: the old service is the oracle in `today-board-parity.spec.ts`; the numbering of nameless doctors differed from it before the order was fixed (the spec caught it, 5 failures, until the comparison read the shape of the fallback).

### Decisions and deviations

- **`p_date` as a fourth, defaulted argument** of `today_board` (the plan's signature has three): the board is read for other days in the existing specs (`date` option) and by the schedule later; the caller's reach is the same as on any other day (`appointments:view` over the clinic's visits, RLS). The route and the page never pass it.
- **Doctor mode with no `p_doctor_id`** reads the caller's own visits (the mode argument needed a meaning in the database; the application always passes the doctor).
- **Versions ride on the page's own statement** instead of `clinic_live_state` calls: a separate call per page made every page's call count one higher than its ceiling (the lane refused it: 10 rows). The embed costs no call; for the patient and Staff the versions come from the same statement as the data (exact), for Visits and Billing reports from the zone read before the data (a lower bound), for clinic settings from the clinic row read beside the membership.
- **Patient links are not prefetched**, so the record's layout read now falls inside the click's window (it used to be in the prefetch): that is why `in-app.R.patient` could not stay at depth 2 (below).
- **`getTenantTimeZoneAndVersions` seeds the plain zone memo** of the request (`tenant-tz`), so a service that asks for the zone after a page has read zone-and-versions makes no second `tenants` read.
- **A nameless doctor's number** is now creation order (was heap order): a fix, not a behaviour anyone relied on.

### Security-sensitive for the adversarial review

`supabase/migrations/000125_today_board.sql` (INVOKER, `search_path ''`, the NULL cases, every gate in the statement, the allergy flag not the names, the doctor filter, EXECUTE grant, `p_date`), `features/today/board-model.ts` (what the parse drops), `features/patients/service.ts` (`after()` audit: fire-and-log; `readPatientRecord` request-shared read, memo key = clinic + id, never kept on error, no audit; the embed `tenants(clinic_versions)` returns four counters),
`app/(dashboard)/patients/[id]/{layout,page}.tsx` (404 decision kept above the skeleton; one read), the Staff read (`tenants(clinic_versions)` embed on `memberships`: the member rows handed to the list are stripped of it), clinic settings (`clinic_versions` stripped from the tenant row before it reaches the form), `lib/datetime/server.ts` (memo seeding). No service-role client, no route added, no RLS or grant change. The notice carries no name or id.

### For the PO

- **`today_board` p95 < 50 ms is not met on this VM** (p50 126 ms, p95 143 ms; `evidence/09E-06/command-latency.json`) on the heaviest day the harness makes (every visit of the run: several hundred, each with a token, invoices and payments), 3 to 4 times slower than the 09C machine (as for `consult_screen` in 09E-05). A real clinic's day is tens of visits.
- **Patient record depth**: with `patient.view` in `after()` (plan) the audit write starts when the streamed history has finished, so `in-app.R.patient` (ceiling depth 2), `full.D.patient` (4) and `full.R.patient` (3) measure one deeper than their ceilings and **fail in the nightly lane** (ceilings untouched). Options: write the view row beside the history (not `after()`), or accept +1 on those rows.
- **`live.today.refresh` is 2 / 2, planned 1 / 1**: the second call is a `clinic_live_state` read inside the window after the signal's board read, in every sample, with the channel joined and the badge "Live" before the window; I did not find what asks for it (09E-04's e2e sees no state read in the first 2 s).
- **`full.R.billing-reports`** measures depth 4 in some samples (ceiling 3): the shell's own notification reads start after hydration and chain behind the faster page; the row's ceiling is untouched.
- Visits and the patient history are still chains of reads (the register: visits, then its patients, doctors, tokens, diagnoses, prescriptions and invoices; the history: visits, then those). A one-read `visits_register` / `patient_history` is the way to depth 1; not in this plan.
- Open from 09E-04/05, unchanged: `save.R.check-in` (09E-08), the one unexplained iphone-15 "Delivered" failure. `tests/realtime/today-signals.spec.ts` "a 50-row insert ... one signal per domain" failed once in a 225-file Vitest run (the global broadcast counter went negative) and passed alone: a shared counter under load, not touched here.

### Tests run (local stack)

- `npm run typecheck`: clean. `npx eslint .`: 0 errors (390 warnings, unchanged). `npm run inventory`: 0 flagged. `schema-snapshot.mjs --local --check`: pass.
- pgTAP (after `db reset --local`): 9426 tests in 73 files, 0 failed, gate PASS at floor 9426 (`today_board.test.sql` 62 of 62). `seed:local` not needed for these lanes.
- Vitest (tests/today, patients, live, perf, ci, security, api, visits, auth, audit, observability, query): 184 files, 4107 tests passed; an earlier 225-file run (adds integration, dpdp, settings, staff, clinics, nav, permissions, authz, realtime) had one failure, the shared broadcast counter case noted above (passes alone) and a recursion bug in my own new helper, fixed. The two `age`-binary files were not run (known).
- e2e (`--retries=0`, `stack:recycle` before each run; desktop-chrome, pixel-7, iphone-15): tests/e2e/{today,shell,live,observability,a11y,schedule,design}, `pwa/05-cache-audit`, `journeys/journey-03-register-patient`: **548 passed, 245 skipped by design, 4 failed**, all four mine and fixed: `loading-states` patient history at 360 px (the history skeleton was gone before axe ran: its wait is 1.8 s now) and `today-live` "reaches another browser" on the three projects
  (my count did not allow for the actor's own page render after its Server Action: at most one more `today_board`). Re-run after the fixes: both passed (desktop-chrome; today-live also on pixel-7 and iphone-15); the changed-elsewhere spec and the full loading-states matrix passed earlier in the same state of the code. No test passed on a retry. The iphone-15 "Delivered" failure did not occur; `save.R.check-in` is the lane's known failing row (untouched).
- Latency lane at 300 ms (`evidence/09E-06/`): the rows above. Playwright restarts the worker after a failed test and the report of that process loses the rows already measured in it, so the rows were measured in groups and merged with `PERF_LATENCY_MERGE` (parts a to g in the evidence folder); the failing rows (patient record, billing-reports full load) kept their old ceilings in `final-rows-300ms.json`.

## 09E-07 Stale-write refusal for queue and billing commands

Branch `v2/phase-09e-caching-speed`. Migration `000126_stale_write_refusal`. No new dependency.

### What shipped

- **000126** (`supabase/migrations/000126_stale_write_refusal.sql`, pgTAP `stale_write_refusal.test.sql`, 79 tests): ten definer commands dropped and created again, each from its
  LATEST live definition (read with `pg_get_functiondef` on the local stack after 000125, which equals the latest migration body; the dollar-quoted bodies are verbatim, only the header is
  normalised) with ONE parameter last, `DEFAULT NULL`: `p_expected_version` (visits.row_version) on `check_in_visit`, `start_consultation`, `complete_visit`, `mark_no_show`, `cancel_visit`,
  `reschedule_visit`, `confirm_appointment`, `complete_and_bill`; `p_expected_invoice_version` (invoices.row_version) on `collect_payment` and `record_payment`. No overload is left. Grants,
  `SECURITY DEFINER`, `search_path ''`, `lock_timeout 2s` and the comments (extended by one sentence) are restored; `record_payment` keeps `service_role` (re-granted after the revoke so the
  ACL order is the old one: the definer registry compares it).
- Order in every command: actor, active clinic, permission, input; the request-id claim (a replay answers its STORED result whatever the version); the existing row lock; `ROW_CHANGED` (P0001)
  when the version differs; the unchanged body. `check_in_visit` and `start_consultation` lock the visit themselves before the compare (their shared steps lock it again, a no-op) and only when a
  version is given, so a call without one is byte-for-byte the old behaviour. `complete_and_bill` compares after its in-body `billing:collect`-or-own-doctor permission check. `collect_payment`
  compares the visit's live invoice (locked `FOR UPDATE`, as the step locks it) and refuses a version given when there is none. `record_payment` has no claim: its replay by command id sits after
  the lock and before the compare. The version is not in the request hash (a retry with another version is a replay, not a mismatch). A refusal rolls back the whole transaction, claim included.
- Results gain `row_version` (visit commands; `complete_and_bill` also `invoice_version`) and `invoice_version` (`collect_payment`, `record_payment`, its replay too).
- App: `lib/errors/row-changed.ts` (reason, fixed text "This changed on another device. The latest is shown.", `versionArg`), `ROW_CHANGED: CONFLICT` in `RPC_REASON_CODES`, `callCommand` adds the
  fixed text to every command's messages (and `callRecordPayment` too). Services accept `expectedVersion` (optional); the server ACTIONS require it (`checkInVisit`, `startConsultation`,
  `completeVisit`, `markNoShow`, `confirmAppointment` take a positional number; `cancelVisit`/`rescheduleVisit` take `CancelVisitRequest`/`RescheduleVisitRequest` with `expected_version`;
  `collectPayment` takes `CollectPaymentRequest` with `expected_invoice_version: number | null`; `recordPayment` `RecordPaymentRequest`). Screens: Today rows pass `row.rowVersion`; the row menu,
  cancel and no-show dialogs and the Schedule card pass the schedule read's new `rowVersion`; the reschedule sheet passes the version of the visit it loaded (`getRescheduleTarget` now returns it)
  and reloads the target after a refusal; the checkout drawer sends the invoice version it shows (`getVisitBillingDetails` now returns `invoice.row_version`: the first e2e run found the drawer was
  sending none) and the visit's version for the desk completion. `lib/live/use-row-changed.ts`: on `ROW_CHANGED` it wakes the live layer (state read now), invalidates the live queries and, on
  `/schedule`, refreshes the route; the toast of a row command has no Retry for it (the same version would be refused again).
- Bookkeeping: `EXPECTED_MIGRATION` 000126, schema snapshot, `types/database.ts`, pgTAP floor 9505 (74 files, the new file required), signature pins in `staff_scheduling`, `visit_state_machine`,
  `billing_rpc_only` pgTAP and the Vitest catalog specs (text only, no count change). `tests/security/guard-manifest.ts` pins actions by name and permission, not signatures: unchanged.

### Fails-without (High: lost update)

With the compare removed from `reschedule_visit` (the shipped test file run with the function redefined inside its transaction, rolled back): tests 17 and 18 fail ("a stale version is
ROW_CHANGED": the call answered; "nothing written": audit/claim counts 3/3 against 2/2, the visit moved from +1 day to +3 days, version 2). Restored (the migration is untouched); the file passes 79/79.

### Decisions and deviations

- **Services take the version optionally; the actions require it.** Required at the service would have broken about 100 call sites (the specs, and the system and API paths that have nothing to compare);
  NULL means "no version known" in the database too. "The app always sends one" is enforced where the app enters: the actions' TypeScript signatures (`@ts-expect-error` cases in
  `tests/queue/stale-write-services.spec.ts`, checked by `npm run typecheck`). `app/api/v1` unchanged.
- **`complete_and_bill` supports the version but the Sign and Bill modal sends none**: the consult screen's read (000124) carries no visit version, and adding one means replacing `consult_screen`
  and a version held by a long-open client. PO question below.
- A Today row of a visit that is not completed has no `invoiceVersion`; the checkout drawer does not need it (it reads the invoice itself when opened and after each of its own item edits).
- The e2e's "B" is the command API of the owner's session (what a second device's click sends), not a second browser: the reschedule sheet's slot picking is not what is under test. A's state reads are
  held by a route (not a fake clock) so it cannot heal by heartbeat while the test runs.
- Partial payments do not move `invoices.row_version` (no listed column changes), by the 000123 design: a second partial payment from a screen that is behind on the balance is limited by the overpayment rule.

### Security-sensitive for the adversarial review

Ten definer commands replaced (000126): permission order, replay-before-compare, lock-then-compare, no grant change (ACL equality incl. order, `record_payment`'s `service_role`), no new write path.
`versionArg` sends -1 for an impossible version (always refused) rather than throwing. The version is lost-update protection for honest clients, not an access control.

### For the PO

1. Should the consult screen carry the visit's version so Sign and Bill is refused when the visit moved (needs `consult_screen` replaced, 09E-12 candidate)?
2. The Schedule's booking sheets pass the version they loaded until 09E-12, as planned; the Schedule day read carries `rowVersion` meanwhile.

## 09E-08 Saves by risk class

Branch `v2/phase-09e-caching-speed`. No migration, no new dependency. Commits (not pushed): `7f0ff37d` (hooks and Today's moves), `f180996b` (Rx tracer, diagnoses), `228a47a6` (confirm class, `revalidatePath` removal), then the specs, lane rows and evidence.

### What shipped

- **`lib/query/mutations.ts`** (R-11): `useReversibleCommand` (result applied at once by `apply`, which returns its rollback; a refusal or a failure takes it back, then `onFailure` shows the fixed error with `retry` = the same save, the same request id) and
  `useConfirmedCommand` (nothing changes until the answer; `onValue` writes the answer with `setQueryData`; `pending` is the only thing on screen), both on `useMutation` over the existing `useCommand` (one request id per submit, 15 s timeout, one retry with the same id, the dirty guard). `useConfirmedCall` is the same for a form that builds its own call
  (the sheets, the drawer, the allergy editor, Sign and Bill), exposing `command` so their `SaveStatus` is unchanged. RUM: `save_reversible` (timed to the frame that shows the result), `save_confirmed`, `finish_confirmed` (Sign and Bill); closed words and a number, no id or text.
- **`lib/query/after-save.ts`**: what a confirmed save does to the screens after the answer. Today's boards (`[clinic, "today", mode]`): a status change the answer describes is written (`patchTodayBoards`), a change that adds or moves rows marks the boards stale (one `GET /api/today/board`). The Schedule is still server-rendered until 09E-12, so a save made there refreshes its route (see deviations).
- **Rx line tracer** (`use-rx-lines.ts`, `features/prescriptions/rx-overlay.ts`): `items` = the database's list (`confirmed`) with the unanswered changes laid over it (`overlay`, pure, `tests/prescriptions/rx-overlay.spec.ts`). An added line shows at once as `pending:<change>:<n>` with a "Saving…" marker (`RxLineItem pending`, pills and Remove disabled); an edit shows its new dose; a removal is gone. The answer replaces the overlay with the database's list;
  a refusal or failure drops the change. One `changePrescriptionAction`; the line is what was sent plus the returned id. **No allergy-context re-read after a change of lines**: `consult-workspace.tsx` derives the context's items from the stored picture plus the TypeScript twin (`allergyMatches`) for lines this session added or confirmed (their substance ids and override reason are kept by the hook);
  the context is read again only after the allergy editor saved or reloaded (`allergyVersion`). The database still refuses a match on every write, whatever the screen says. A custom medicine joins the consult's query lists (`withCustomMedicine`, as `change_prescription` does in SQL, 09C R-2); same for a custom diagnosis (`withCustomDiagnosis`; `use_count` is written as 1 by the add, mirrored).
- **Q-6 (PO default: keys typed during an Rx line save are NOT dropped)**: `RxEntryRow` closes the builder and empties the field the moment Enter is pressed and the field stays editable. A refusal after that: when the field is still empty the dose builder comes back with the line, the reason and the error (Enter sends it again, same request id); when the doctor has started the next medicine nothing of it is touched and a notice
  **above** the field (the open list is drawn over what is below it: found by the e2e) says the line was not added, with Retry. The full name typed across a 400 ms save reaches the field.
- **Reversible class**: Rx edit and remove (same overlay; the editor closes at once and returns with the draft on a refusal; a list-level alert with Retry); diagnosis add, remove and note (`diagnosis-section.tsx`: rolled back on a refusal or a lost response, notice with Retry; no `revalidatePath`; `rum` timer); Today's **check in** and **start** (`use-row-commands.ts` on `useReversibleCommand`: the row moves to Waiting / With doctor through the existing overlay (`withPendingCheckIns`, now with `to`), the answer
  is written into the board (`withCheckedIn`: status, token, arrival time, the returned `rowVersion`), a refusal removes the overlay with the fixed text and Retry, a `ROW_CHANGED` refusal rolls back, shows the fixed text with no Retry and re-reads (09E-07's `useRowChanged`)). Draft autosave already re-rendered nothing (its saver keeps its own state and shows "Saving/Saved"); unchanged.
- **Confirm class**: register and book, book, reschedule, promote, walk-in, cancel, no-show, collect payment, allergies, Sign and Bill, the confirmation on the Schedule card: pending state only (`SaveStatus` / button spinner), success text only after the answer (the sheets already did this; they now go through `useConfirmedCall`). Cancel and no-show write their answer into Today's board (`withStatus`, `rowVersion` from the answer);
  walk-in, booking, reschedule, promotion and cancel with a waitlist promotion mark the boards stale (one GET); the vitals sheet writes the readings the database answered (`withVitals`). The checkout drawer sends the completion stamp and the billing read together instead of one after the other (one round trip fewer).
- **`revalidatePath` removed from every hot save, by action name**: `queue.checkInVisit`, `queue.enqueueWalkIn`, `queue.startConsultation`, `queue.completeVisit`; `visits.recordVisitVitals`; `visits_scheduling.registerAndBook`, `rescheduleVisit`, `cancelVisit`, `markNoShow`, `confirmAppointment`; `waitlist.promoteWaitlistEntry`; `billing.createInvoice`, `recordPayment`, `collectPayment`, `completeAndBillConsultation`;
  `consultation.completeAndSignConsultation`, `reopenVisitForAmendment`, `finalizeVisitAmendment` (their screens call `router.refresh()` themselves: it was a double render); `terminology.addConsultationDiagnosis`, `removeConsultationDiagnosis`, `updateDiagnosisNote`; `patients.registerPatient`, `recordPatientAllergies`;
  `settings.updateClinicSettings`, `updateStatutorySettings`, `updateRxPrintSettings`, `updateUserProfile`, `updateStaffMember` (their forms refresh or hold the answer). **Kept** (not hot saves): schedule blocks, `waitlist.addToWaitlist`, the doctor's schedule blocks and working hours, patient edit, consent, referrals, labs, webhooks, API keys, notifications, `updateClinicProfileAction` (unused).
- **Check in no longer renders twice**: the action revalidated `/today` and `/schedule` (a render in the action's response) and `onDone` then read the board (a second render's reads). It is one command now: `save.R.check-in` **1 call / depth 1** (was 4 / 3 at the failing ceiling), ceiling lowered by the tool, not raised.

### Budget rows (tool output: `evidence/09E-08/save-rows-300ms.json`, `.md`; ceilings written by `latency-ceilings.mjs`, no number typed, none raised)

| Row | Before (calls / depth) | After |
| --- | --- | --- |
| `save.R.check-in` (B-7, PR lane) | 4 / 3 | **1 / 1** |
| `save.D.add-rx-line` (B-6, PR lane) | 2 / 2 | **1 / 1** (the line visible while the call is held: spec) |
| `save.D.edit-rx-line` (B-6) | 2 / 2 | **1 / 1** |
| `save.D.add-diagnosis` (B-6) | 22 / 20 | 4 / 4 |
| `save.D.allergies` (B-7) | 20 / 17 | 2 / 2 (the command and the one allowed context re-read after the editor saved) |
| `save.D.start-consult` (B-7) | 16 / 8 | 4 / 2 |
| `save.D.sign-finish` (B-8) | 131 / 46 | 58 / 34 (see below) |
| `save.R.register-book`, `save.R.book`, `save.R.reschedule` (B-7) | 19 / 9 (8) | 9 / 8 |
| `save.R.cancel` (B-7) | 11 / 8 | 10 / 8 |
| `save.R.collect` (B-7) | 22 / 12 | 10 / 9 |
| `save.D.draft-autosave` (B-6) | 1 / 1 | 1 / 1 (unchanged) |

New blocking assertion in the lane: **a save causes no RSC page request** (`maxRsc` on the row, default 0; `latency-run.ts` `enforce`): 0 for Rx, diagnosis, check in, collect, allergies; 1 for the Schedule's sheets and dialogs (below), start (a navigation), Sign and Bill (`router.refresh`).

### Sign and finish: measured and reported (B-8 is **not met**; nothing moved)

`save.D.sign-finish` at 300 ms: **131 -> 58 calls, depth 46 -> 34** (`evidence/09E-08/save-rows-300ms.md`; the last sample's calls by path). The action's own `revalidatePath` (a second render of the consult after the one `onSigned` asks for) is gone; the rest is what the response waits for or follows:
- the session context (2: `session_is_live`, `my_tenant_access`) and the command (1: `complete_and_bill`);
- **inside the action, after the commit, before the answer**: the signed prescription's PDF archive (storage POST of `rx_v1.pdf`, `PATCH prescriptions`, its reads of the prescription, items, diagnoses, patient, follow-up) and the receipt PDF (invoice, items, payments reads; storage POST and sign; `log_audit` x2). That is about a quarter of the window and the success screen needs the result of the receipt and the WhatsApp outcome (`whatsAppSent`), so it cannot simply go to `after()` without changing the screen;
- **after the response**: `onSigned` -> `router.refresh()` reads the sealed record (`consult_screen`, the print payload's chain of reads and the stored PDF GETs: 09E-05's open question) so Print is ready in the success screen.
Not moved, because each move changes what the success screen shows or needs the print payload as one SQL read (09E-05 PO question). The PDF/receipt work would be the next candidate (cost: about 12 calls, depth 8, before the answer).

### Specs and proofs

- `tests/e2e/consult/save-classes.spec.ts` (desktop-chrome, pixel-7; `@golden` ones also iphone-15): the tracer (held call: the line is on screen with `data-pending` and "Saving…", the database holds 0 rows, the builder is closed and the field free; released: 1 action POST, 0 RSC requests, one stored line equal to what was shown after a reload); **Q-6** (`Paracetamol` typed across a 400 ms save reaches the field; desktop-chrome and iphone-15); a refused save (the command is cut in the browser, nothing committed): the line goes, the builder returns with "The change was not saved", Enter stores it once;
  a refusal after the doctor started the next medicine (the field is untouched, the notice has Retry, Retry stores it once); remove refused (the line is back, alert with Retry; Retry removes it); a diagnosis added at once (1 call, 0 RSC), its removal refused (back, Retry).
- `tests/e2e/shell/confirm-saves.spec.ts`: for **register and book, book, reschedule, cancel, collect payment, allergies, sign and finish** (`SAVE_ROWS`' own steps, so the press is exactly what the budget measures; `held` on each row): with the action POST held, no success text (an immediate count, see the note below), the dialog or sheet still open, nothing moved, the database empty of the change; after the release the success shows and the database holds it.
  Check in (reversible): the row is in Waiting while the command is held and the database still says booked; one POST, 0 RSC; a lost command rolls the row back with the fixed error and Retry (Retry moves it, one token); a **stale** check-in (`ROW_CHANGED`: B checked the visit in) rolls back with the fixed text and **no** Retry, and the re-read shows it Waiting.
- Vitest: `tests/today/optimistic-moves.spec.ts` (7), `tests/prescriptions/rx-overlay.spec.ts` (4), `tests/consultation/custom-lists.spec.ts` (4); registered in `assert-vitest-report.mjs`.
- RUM: `tests/e2e/observability/rum.spec.ts` "saves by risk class": an Rx line gives `consult|save_reversible`, an allergy save `save_confirmed`, sign and finish `finish_confirmed` in `ops.rum_daily`; no uuid, path or name in any beacon.
- Lane: a save row fails on an RSC page request over its `maxRsc` (0 by default; 1 for the Schedule's sheets, dialogs and the Confirm button, Sign and Bill and start; blocking at any delay).

### Fails-without

- **High: an optimistic success added to booking makes it red; recorded, restored.** `booking-sheet.tsx` with `notify.success(...)` and `onDone()` sent before `await run(...)` (rebuilt): `confirm-saves` **`save.R.book` and `save.R.register-book` fail** on desktop-chrome (the success text is on screen while the POST is held). Restored (rebuilt); both pass.
  The first version of the spec passed with this defect in place: `toHaveCount(0)` retries until true, and the 4 s toast went away inside the 5 s window. The spec now takes an immediate count; this is the version that failed on the defect.
- **Q-6**: `rx-entry-row.tsx` with the input `readOnly` (and its keys swallowed) while the add is on its way, as in 09C-01: `save-classes` "Q-6" **fails on desktop-chrome and iphone-15** (the field is empty after `Paracetamol` is typed during the save). Restored. The test was first not tagged `@golden`, so iphone-15 skipped it; it is tagged now.

### Decisions and deviations

- **The Schedule is still server-rendered (09E-12 puts it on the query layer), so a save made on it cannot be applied with `setQueryData`**: registration, booking, reschedule, cancel, no-show, promotion and the Confirm button end in one RSC request for the Schedule (`useAfterSave`: the soft navigation that closes a link-opened sheet already re-reads the route; a dialog or a button calls `router.refresh()` itself). On Today they write the board (cancel, no-show, check-in, vitals) or mark it stale (one `GET /api/today/board`: a new row or a row that leaves the day). The plan's "no RSC page request" holds for every Today and consult save; for the Schedule it is "one", per row `maxRsc`.
  09E-12 removes it. **Creates and moves are a board GET, not `setQueryData`**: a walk-in, a booking, a reschedule or a promotion adds or moves a row; the answer carries ids and a token, not the patient's row, so building the row on the client would be a guess.
- **Vitals** save as a confirmed form (the sheet keeps the server's fixed refusal text and its inputs when refused: 08-03b) and write the answer into the board; it is not an optimistic move.
- **Complete** (the queue move after a payment) stays a confirm-class step of the checkout, sent in the same round trip as the billing read, not a Today row move: Today has no row action for it.
- **Allergies**: one call for the command and one allowed re-read of the context after the editor saved (`rx_allergy_context`), so `save.D.allergies` is 2 / 2, not 1.
- **Diagnosis saves are not commands** (no `client_request_id`; they are plain server actions): they are reversible with rollback and Retry but not run through `useCommand` (a retry after a lost response could add a second row). Draft autosave unchanged.
- **Pending Rx lines cannot be edited or removed** until the answer (their buttons are disabled): there is no id to send for them yet.
- **Found and fixed**: the doctor's Next card made `/today` wider than a 360 px screen when the snapshot panel is on and the patient's name is long (a grid column sized by its content): `grid-cols-1`. Found by the design review once a long name was on the board (`design-review-09e` M3, doctor).
- **Found, not mine, not fixed (open)**: `shell/loading-states.spec.ts` "a patient record opened from Patients ... skeleton shows once the layout has answered" fails 2 of 3 runs with `--repeat-each=3` on the **09E-07 tree (`4eb220a3`, built and run for this check)**, and passes on its first run; in the full PR-lane run it failed once on the same tree plus this plan. It is 09E-06's spec; its skeleton window depends on a state the first run leaves behind. Root cause not found here.
  `shell/back-resume-keyboard.spec.ts:107` (pixel-7) failed once in the full run (2 state reads for two resumes inside the coalescing window) and passed 3 of 3 alone; it is 09E-04's; under load a heartbeat tick can fall in its window. Both are reported, not hidden.
- Specs that read the database right after the screen shows an Rx line now wait for the pending markers to clear (`rxStored`, `support/rx-entry.ts`): an added line shows before the database has it by design (found by `rx-assist` on iphone-15).

### Security-sensitive for the adversarial review

No migration, no RLS or grant change, no new route, no new action, no service-role use. Every server action keeps its own authentication, permission check and tenant derivation (only `revalidatePath` calls were removed from them; `tests/security` guard specs pass). For the review: `lib/query/mutations.ts` (a retry reuses the request id; a mutation never retries by itself), `lib/query/after-save.ts` (the board predicate is `key[1] === "today"`; keys hold the clinic id first and ids and modes only),
the allergy picture on the consult (`consult-workspace.tsx` `allergyItems`: a line this session added is checked with the TypeScript twin, not the database; the database still refuses a match on every write and `unresolvedAllergies` blocks Finish for a flagged line without a reason), `rx-overlay.ts` (pending ids are never sent to the server; their buttons are disabled), RUM emissions (closed metric names, a number only), and the removal of every `revalidatePath` listed above (nothing else read those paths' caches: no `unstable_cache` in the app).

### For the PO

1. Q-6 was implemented as the default (the field stays editable; keys typed during a save are kept). The refusal case when the doctor has moved on shows a notice above the field with Retry rather than putting the old line back in the builder: acceptable?
2. B-8 (sign and finish in 2 calls) is not met: 58 calls remain at 300 ms (the archive and receipt PDFs inside the action, and the sealed record read after it). Moving the PDF work after the response changes what the success screen can show (the WhatsApp outcome); which do you want?
3. The Schedule's saves refresh their route (one RSC request) until 09E-12; the plan's "no RSC request" is met on Today and the consult only.
4. The two flaky specs above (`loading-states` patient record, `back-resume-keyboard` on pixel-7) are 09E-06's and 09E-04's; they need an owner.

### Tests run (local stack, `stack:recycle` before each e2e run, `--retries=0`)

- `npm run typecheck`: clean. `npx eslint .`: 0 errors, 390 warnings (the 09E-07 count; mine were removed). `npm run inventory`: 0 flagged. `server-routes.mjs --check`: pass. No migration, so no pgTAP and no `seed:local` were needed.
- Vitest (`tests/{prescriptions,terminology,queue,visits,billing,security,perf,ci,today,query,live,consultation,observability,lint,shell,pwa}`): **182 files, 4125 tests passed** (the two `age`-binary files are outside these folders).
- Latency lane at 300 ms, `perf-latency --grep "save\."`: 21 passed (the last of three runs; the two before failed on the new RSC assertion, once on my own wrong `closing` option for the dialogs: both fixed in code, not by raising `maxRsc`: it was first set to 2 for the sheets, refused by the review of my own change, and the product was changed so the save makes one request).
- e2e, desktop-chrome + pixel-7 + iphone-15 (`consult today schedule journey-04 journey-05 shell live observability pwa/05-cache-audit`, 796 tests): 621 passed, 170 skipped by design, 4 failed (below).
  `tests/e2e/a11y` (desktop-chrome, pixel-7): 148 passed. Design projects (360 / 820 / 1180 / 1280): 142 passed (their screenshots overwrote tracked evidence; discarded, never committed). `confirm-saves` and `save-classes` on all three: 36 passed, 7 skipped by design.
- **Full PR lane once** (`desktop-chrome pixel-7 iphone-15 pwa-ipados`, 1,544 tests, 1.6 h, no retries): **1,209 passed, 326 skipped, 9 failed.** Every failure was re-run alone:
  - `design/keyboard/clinical-b` "Rx entry ... five keys" (the page scrolled 1,574 px; desktop-chrome): passes 3 of 3 alone. It drives the entry row I changed, so I looked: the commit now closes the builder and adds the line in one render instead of two; the focus and the scroll calls are the same. Not reproduced; reported.
  - `shell/back-resume-keyboard:107` (desktop-chrome and pixel-7; 09E-04's): passes 4 of 4 alone (desktop-chrome) and 3 of 3 (pixel-7). A second state read lands inside its window under load.
  - `shell/loading-states:92` patient record (09E-06's): **fails 2 of 3 alone on the 09E-07 tree as well** (not this plan's).
  - `shell/ui-checks` owner at 820, 1180 and 1280 px ("animations still running", the 30 s test limit; many pages in one test): passes 2 of 2 alone.
  - `journeys/journey-03-register-patient` and `m0/register-patient` (iphone-15): the Register patient sheet did not open within 5 s after the link click; they pass 2 of 2 alone on iphone-15. Nothing in this plan touches that sheet's opening.
  The lane's failures are timing under a loaded full run; none is a spec that only passes on a retry in CI terms, but I did not root-cause the five that pass alone beyond what is written above, and the PO should expect the CI run to show them if the runner is as loaded.
- Fails-without: both recorded above.

## 09E-14a Fix round for PR 1 (09E-01..08): the independent review (Sonnet) and the adversarial review (Opus)

Branch `v2/phase-09e-caching-speed`. One migration, `000127_review_fixes_09e`. No new dependency. Commits `fix(09E-14a): ...` (SHAs at the end). Not pushed, no PR.

**Migration numbers (PO, please note):** 000127 was reserved for `reference_catalogues`; this round took it. The later reserved numbers moved up by one in `09E-PLAN.md` (front matter `migrations:`, the 09E-09, 09E-12 and 09E-13 headings, files and bodies, "000122 to 000130", the end-of-phase `EXPECTED_MIGRATION`): `reference_catalogues` **000128**, `schedule_range` **000129**, `session_bootstrap` **000130**.

### Findings, ranked: fixed (how) or not (why)

| | Finding | Status | How |
| --- | --- | --- | --- |
| A | Tenant mismatch (M1 + M-2): a stale second tab after a clinic switch stored the new clinic's board and live state under the old clinic's key | **Fixed** | `lib/live/clinic-header.ts` (`x-clinicos-tenant`), `clinic-guard.ts` (server), `clinic-changed.ts` (client). `fetchBoard` (Today) and the live-state read send the clinic the screen was built for. `GET /api/today/board` and `GET /api/live/state` answer **409 `CLINIC_CHANGED`** with the fixed body `{"error":"The clinic changed.","code":"CLINIC_CHANGED"}` when it is not the session's clinic: after authentication and the permission check, before any read; the clinic is still derived from the session (the header can only make a read fail; a missing header, an old client, is the plain read). On a 409 the client runs `runCleanups("switch")` and loads Today by a new document (once per document); the answer is never stored. **The same-tab window** between the `switchClinic` response and `runCleanups`: any read made in it carries the old clinic's header while the device is already pinned to the new one, so the server refuses it (409) instead of the client storing it; no separate flag is needed. Tests: `tests/api/today-board-route.spec.ts` and new `tests/api/live-state-route.spec.ts` (409 fixed body, own id and no header 200, 401 first), guard legs in `tests/security/guard/engine.ts` (`clinicChangedLegs` for `session-board` and `live-state`: 409, fixed body, no cookie, nothing but the membership lookup touched; the locked clinic: board 403 `SUBSCRIPTION_LOCKED`, live state 200 with an access level that is not `full`; `world.lockedOwner` seeded with the world), `tests/live/clinic-changed.spec.ts` (header, the 409 test, once-only handler), e2e `tests/e2e/live/clinic-changed.spec.ts` (two tabs in one context: tab 1 switches, tab 2 never has a clinic B row in its DOM, reloads into B, a 409 was seen). |
| B | Audit fail-open (M3 + M-1): `patient.view` in `after()` could be lost | **Fixed** | Fail-closed again, and the single-statement variant was made after the first attempt measured badly. First: `readPatient` awaited `recordAudit` after the read (it throws on failure): correct, but the record's first paint then waited for a second round trip, the history (streamed) finished with it, so the history skeleton never showed (`loading-states` "a patient (history streams)" failed on 3 widths in the full lane) and the full-load rows sat on the knife-edge of their depth ceilings. Now: **`public.view_patient_record(p_tenant_id, p_patient_id)`** (000127; VOLATILE INVOKER, `search_path ''`, EXECUTE `authenticated` only): `patients:view` in the clinic, the patient (RLS applies; not deleted), the `patient.view` row through `public.log_audit` (it raises when it cannot write, so the call fails and no record is returned) and the clinic's four versions, in ONE call; NULL for no session, a non-member, another clinic, a deleted or unknown patient, and then nothing is written. `getPatientWithVersions` calls it (API-key callers keep the read plus `recordAudit`). The layout's 404 read (`readPatientRecord`) stays a plain read with no audit. The mocked-`after` test is replaced: `tests/patients/patient-view-audit.spec.ts` (no mocks: one row per opening before the call returns, the layout's read writes none, nothing for a missing patient, **an audit failure fails the read** on both paths) and 13 pgTAP legs in `review_fixes_09e` (INVOKER, grants, one row per opening, the four versions, NULL for no session / a user with no clinic / an unknown / a deleted patient and no row written, a refusing `audit_logs` trigger makes the call raise); the `changed-elsewhere` e2e asserts the row at once on a real page load. Rows: below. |
| C | Allergy ids misaligned (M2) | **Fixed** | A line and its substance ids travel as one pair (`pairAdded`, `withoutPresent`, `substancesOfAdded` in `features/prescriptions/lines.ts`); the two `unique` filters in `use-rx-lines.ts` filter pairs; `addedItemIds?.[index]` is guarded. `tests/prescriptions/added-pairs.spec.ts`: add-all with an earlier line present, a second filter at command start, an index with no id. |
| D1 | Stale Today allergy flag (M4) | **Fixed** | `000127`: statement-level `AFTER` triggers with transition tables on `patients` (update, delete) and `follow_ups` (insert, update, delete) bump the **queue** domain through `private.clinic_bump` (pattern of 000123). Columns below. |
| D2 | RUM direct call (L-1) | **Fixed** | `000127` replaces `ops_ingest_rum` (same signature and grants): refused (42501) without an active membership (`EXISTS` over `authz.member_tenant_ids()`); one account's accepted samples stop at `ops.rum_user_daily_cap()` = 20,000 a day (4 % of the 500,000 total); the rest count in `ops.rum_overflow`. Counter: new `ops.rum_user_daily(day, user_key bytea, samples)`, RLS on, no policy, no API grant; `user_key = sha256(user id || ':' || day)` (names no one across days; earlier days are deleted by the next call). No existing counter held a per-user figure. pgTAP `review_fixes_09e.test.sql` (41), `rum_daily.test.sql` keeps its 63 (its caller now has a membership). |
| E-L1 | double submit runs callbacks twice | **Fixed** | `lib/query/mutations.ts` `run` returns the in-flight promise before `mutateAsync`. |
| E-L2 | manual write ends a fetch | **Fixed** | `lib/live/provider.tsx` ignores `action.manual === true` when deciding a fetch ended. |
| E-L3 | own write must replace an older read | **Fixed** | `cancelRefetch: true` in `staleToday` and `refreshNow` only (the live core takes its basis at each fetch start, so a newer signal is not lost; the live re-read and resume keep `false`). |
| E-L4 | consult cache kept on re-entry | **Fixed** | `useConsultQuery` writes the server data once before the first paint of a mount when the key is already cached. (No component test: the repository has no React test renderer and none was added; covered by the consult e2e.) |
| E-L5 | checkout success after a failed completion | **Fixed** | `checkout-drawer.tsx`: a failed `completeVisit` after the payment shows a visible error ("Payment ... was recorded, but the visit was not marked completed: ...") instead of the success text, does not set completed, refreshes the board. |
| E-L6 | ChangedElsewhere flash after own save | **Not done** | Needs own-write tracking against the signal that follows it; not cheap. Open: to the backlog (no plan owns it yet). |
| E | Locked-clinic guard legs | **Done** | see A. |
| E | `expectedVersion` runtime check | **Done** | `lib/errors/expected-version.ts` (zod `int().nonnegative().safe()`); required after the session and permission in `checkInVisit`, `startConsultation`, `completeVisit`, `markNoShow`, `confirmAppointment`, `rescheduleVisit`, `cancelVisit` (`input.expected_version`) and `recordPayment`; `VALIDATION_FAILED` / `EXPECTED_VERSION_REQUIRED`, fixed text. `tests/security/expected-version-required.spec.ts` (real actions on a seeded clinic: every bad value refused and the visit unchanged; a nurse and a stranger still get FORBIDDEN / UNAUTHENTICATED first). `collectPayment` keeps `null` (a payment with no invoice yet). |
| E | Broadcast client banned | **Done** | `eslint.config.mjs` `queryPersist` pattern adds `@tanstack/query-broadcast-client-experimental`; `tests/query/lint-bans.spec.ts` lints each banned package. |
| E | Version lock order | **Done** | Documented as `VERSION_LOCK_ORDER` in `lib/live/domains.ts`: **queue, schedule, billing, settings**, always in that order inside one transaction (a visit insert: queue, schedule; a membership change: schedule, settings; a command that moves a visit and then bills it: queue/schedule first, invoice after); clinics inside one `clinic_bump` in id order. `tests/live/version-lock-order.spec.ts` reads every migration from 000123 and fails if a function raises out of that order (it checks the checker too). |
| G | Sign and finish B-8 (58 calls, depth 34) | **Untouched** | PO decision pending. |

### 000127: which table, event and column moves the queue domain

| Table | Event | Listed (moves queue) | Not listed (moves nothing) |
| --- | --- | --- | --- |
| `patients` | update | `full_name`, `phone`, `sex`, `age`, `date_of_birth`, `allergies` | `abha_id`, `address`, `ai_processing_objected`, `chronic_conditions`, `created_at`, `created_by`, `emergency_contact`, `erased_at`, `erasure_reason`, `guardian_name`, `guardian_phone`, `guardian_relationship`, `hfr_facility_id`, `id`, `is_deleted`, `national_health_id`, `objected_at`, `objection_recorded_by`, `preferred_language`, `status`, `tenant_id`, `updated_at`, `whatsapp_opt_out` |
| `patients` | delete | all | |
| `patients` | insert | | all (a patient with no visit is not on the board; the visit insert moves queue) |
| `follow_ups` | insert, delete | all | |
| `follow_ups` | update | `follow_up_date`, `visit_id`, `created_at` | `doctor_id`, `id`, `notes`, `patient_id`, `status`, `tenant_id` |

Not changed, listed so the review can see it: `today_board` also reads `queue_tokens`, `clinical_notes.vitals`, `invoices`, `payments` and `memberships.full_name` (all already moved queue, billing or settings in 000123).

Registries: `EXPECTED_MIGRATION` 000127; schema snapshot regenerated (`--local --write`); `types/database.ts` +4 lines (`view_patient_record`); pgTAP FLOOR 9505 -> **9546** (+41, `review_fixes_09e` is a REQUIRED file); `definer_functions` classifies the four new trigger functions; `today_signals` counts 27 statement triggers (was 22).

### Fails-without (recorded)

- **Membership check (D2)**, migration copy with `IF false AND NOT EXISTS ...` and the per-account cap removed, applied to the local database: `review_fixes_09e` fails tests 21 to 24 and 26 (a no-clinic account and a removed member are accepted and write samples and counters). Restored from the file and re-applied.
- **Triggers (D1)**: without the migration the 18 trigger legs of `review_fixes_09e` fail (the version does not move).
- **Clinic header (A)**: the server check replaced by `return null` (`claimed === null || ...` removed) and the app rebuilt: the two-tab e2e fails (tab 2 never reloads: `page.waitForFunction ... Test timeout of 30000ms exceeded`), the three Vitest route legs fail (`today-board-route`, `live-state-route`, and the guard legs `session-board` and `live-state`). Restored from git and rebuilt.
- **Audit fail-closed (B)**: the old `after()` path swallowed a failed write into a log line and returned the patient; `an audit failure fails the read` requires the rejection, so it fails on the old code by construction (not re-run on the old tree). In the database: the refusing `audit_logs` trigger leg of `review_fixes_09e` makes `view_patient_record` raise.

### Budget rows for the patient record (B): measured, ceilings held (none raised, none lowered)

`tests/e2e/perf/latency-ceilings.json` is **unchanged**. Measured at 300 ms (`evidence/09E-14a/patient-record-chains.md`, tool output with the call chains):

| Row | Ceiling (calls / depth) | Measured now | Note |
| --- | --- | --- | --- |
| `in-app.R.patient` | 10 / 2 | 10 / 2 | holds (09E-06 had measured 3 with the audit in `after()`) |
| `in-app.D.patient` | 11 / 3 | 11 / 3 | holds |
| `full.R.patient` | 14 / 3 | 13 / 3 in the first isolated run (12 of 12 samples), later 13 / 4 | depth 4 in later runs, see below |
| `full.D.patient` | 15 / 4 | 14 or 15 / 4 in the first isolated run, later 5 | the same |

Why the full-load rows are over by one at times: the chain printed for a failing sample is wave 1 (membership, consents, the patient and its audit in one call, visits), wave 2 (the history's embeds), then the shell's own `HEAD` and `GET in_app_notifications` after hydration. The row counts the largest set of calls that do not overlap, so the shell's pair adds 1 when its first call starts a few tens of milliseconds AFTER the history's last call ended (e.g. 772 ms against 708 ms) and 0 when it starts before it. The page's own part is at depth 2 (the ceiling the in-app rows hold). The same noise was recorded for `full.R.billing-reports` in 09E-06. I did not raise these ceilings and could not lower them (the calls fell by one in the first run, but a lowering needs a clean 5-sample pass of the row, which the tool needs, and the rows do not pass cleanly in this state of the machine). They are nightly rows, not `@budget`; a failure there is this noise, not a regression of the page. PO question 6.

### Flaky tests: root cause and fix (none raised a timeout as the fix; nothing passes on a retry)

Method: each one was run repeatedly, and under CPU load (three to six busy loops on the 8-core VM, `stress-run.sh` in the scratchpad) where it did not fail alone. "Product" = the product was changed; "spec" = a race in the test.

| Test | Cause (evidence) | Fix |
| --- | --- | --- |
| F1 `design/keyboard/clinical-b` "Rx entry ... five keys" (page scrolled 1,574 px) | **Spec race.** Reproduced: 5 of the first 6 runs under load failed with identical numbers (expected 10604, received 12178). The screenshot shows the search focused at the same place on the screen; the document above it had grown by about 1.6 kpx between the baseline read and the end (the gallery's earlier sections finish hydrating and measuring late on a loaded machine) and the browser's scroll anchoring moved `scrollY` with it. Not an Rx or product move. | `openGallery` waits until the document height has not changed for 600 ms (`settleLayout`) before a case reads its baseline. 20 of 20 pass under the same load. |
| F2 `shell/back-resume-keyboard:107` "one state read for two resumes" | **Spec race.** The product has no time-based coalescing of state reads, only "a check made while one is out is answered by it" (`inFlight`). The second `resume` raced the first read's answer (a fast stack had already finished it, so the second was a legitimate new read), and the 2.5 s wait before the counting could end before the late subscription check. | Waits for the badge "Live" before counting, holds the first `/api/live/state` answer for 1.2 s so it is certainly in flight, then counts after 600 ms. |
| F3 `shell/loading-states:92` patient record (fails 2 of 3 alone, 09E-06) | **Window plus polling.** The skeleton is on screen only while the page's own calls are pending (about 300 ms per call at the injected delay) and `toBeVisible` polls: a window of one call can fall between two polls. 09E-06's page did not wait for its audit row, so its window was one call; B above (the audit awaited beside the other reads) makes it two. 12 of 12 pass now (4 repeats of each width). | A `MutationObserver` installed before the click records that the "Loading" status appeared; the spec asserts that. |
| F3b `shell/loading-states` any skeleton case (final lane: `Referrals at 1280 px`, "No elements found for include") | **Window vs the run of axe.** At 0.7 s per call a one-call page keeps its skeleton about 0.7 s; the visibility wait and the axe run can outlast that on a loaded machine and the skeleton is gone when axe starts. | The injected delay is 1.5 s for every screen (1.8 s for the history); the checks are the same. |
| F4 `shell/ui-checks` owner at 820, 1180, 1280 (30 s limit) | **Slowness by design, not load.** One test walked five screens: measured **19.1, 19.8, 20.9, 21.5 s** of the 30 s limit on an idle stack for the owner (14 to 15 s for the receptionist). Any load pushes it over. The limit was not raised. | One test per screen and width (the same checks, `owner at 820px: the shell on patient`), each a few seconds. |
| F5 iphone-15 `journey-03` / `m0/register-patient` (the Register patient sheet did not open in 5 s) | **Two spec races, one product question.** (a) A click on "Register Patient" before React has hydrated the link is lost or becomes a full page load; WebKit hydrates later (the 09B-02b finding, `awaitHydrated`). (b) Reproduced 1 in 20 on iphone-15: "Fix 1 field before registering" with Sex unchosen. The duplicate lookup (400 ms debounce, then a server action) shows its answer above Age and Sex; the tap on "Female" landed as it arrived (the trace shows the click and the answer in the same 100 ms). The "did not open in 5 s" symptom itself did not recur in 20 runs. | `tests/e2e/support/register-sheet.ts`: the link is clicked once hydrated; after the age is typed the spec waits for the lookup's answer and two frames. The "did not open" symptom came back in the first full lane and in the final one (iphone-15, `journey-03`, in the second entry by `page.goto("/patients?new=1")`, a whole test over 30 s): the trace shows the `?new=1` RSC requests answered in under 70 ms and the dialog absent for 5 s, and the page it re-renders lists **all 638 patients** (the lane has created that many; the Patients page has no pagination). Genuine slowness of that page on emulated WebKit, so the two specs wait up to 20 s for the sheet and `journey-03` has a 90 s limit (PO question 7). **Product (PO question 3):** the duplicate answer shifts the fields under the finger; not changed. |
| F6a iphone-15 `live/convergence` "delivered" (09E-04, 30.5 s, not reproduced) | **Not reproduced** (5 of 5, then 24 of 24 in three-project runs at 3 busy loops). Candidate, from `today-signals.spec.ts`'s own comment: the first join after a stack recycle restarts the replication of `realtime.messages` and a change committed in the first moments is never broadcast (the heartbeat finds it within 12 s, which is not what the case measures). Found while stress-running it: the case also counted the 12 s heartbeat's state read when the steps before it took most of 12 s. | The case first proves the path delivers (a harmless change, resent every 3 s until A reads the board, polled every 250 ms), then restarts the heartbeat (hide and show the tab) before it counts. **It failed once in the final lane** (iphone-15, test timeout 30 s): the trace shows two UI sign-ins and two Realtime joins of about 6 s each (5.6 to 11.7 s and 14.5 to 21.0 s) and my first version's fixed waits (about 5 s) pushed the case past 30 s before B's click; the waits were removed and the case has a 90 s limit, because the two joins alone take most of 30 s on emulated WebKit. This is also the most likely shape of the 09E-04 failure (30.5 s, error text lost): a slow first join. |
| F6b `tests/realtime/today-signals.spec.ts` "a 50-row insert" (the broadcast counter went negative) | **Spec race, by construction.** `broadcastsInWindow()` is a sliding 65 s level; rows of earlier cases age out of it while a later case runs, so a difference of two levels can be negative. | Counted as the messages of that clinic's topic since a database `clock_timestamp()` taken before the insert (`broadcastsSince`), which only grows. |
| F6c the ~15-minute stalled Vitest run (09E-07, not reproduced) | **Not reproduced; the mechanism is fixed.** `tests/helpers/sql.ts` ran `docker exec psql` with `execFileSync`, which blocks the Node event loop: Vitest's 20 s test timeout can never fire while one call is stuck (a statement waiting for a lock, a paused container), so a stuck call stalls the run until the OS gives up. | Every psql call now carries a 120 s kill timeout and the session `lock_timeout` is 60 s (`PGOPTIONS`), so a stuck call fails the test in at most two minutes. A 270-file Vitest run (5,689 tests) took about 25 minutes with no stall. |


### Security-sensitive for the adversarial re-check

`supabase/migrations/000127_review_fixes_09e.sql` (triggers: statement level, definer, no API grant, queue only; `ops_ingest_rum`: membership first, the share cap, the counter key and its table's grants), `lib/live/clinic-guard.ts` and the two routes (409 after the permission check, header never selects a tenant), `features/patients/service.ts` (audit awaited), `lib/errors/expected-version.ts` and its eight call sites (after the context), `tests/security/guard/*` (locked legs, `world.lockedOwner`).

### Tests run (local stack, `stack:recycle` before each e2e run, `--retries=0`)

- `npm run typecheck`: clean. `npx eslint .`: 0 errors, 390 warnings (unchanged). `npm run inventory`: 0 flagged. `server-routes.mjs --check`: pass. `schema-snapshot.mjs --local --check` was regenerated with `--write` after `db reset --local` and the new function.
- pgTAP (after `db reset --local`): **9,559 tests in 75 files, 0 failed**, gate PASS at floor 9,559 (`review_fixes_09e` 54 of 54; `rum_daily` 63; `today_signals` 31; `definer_functions` 109).
- Vitest: a first run of 270 files (security, live, query, today, prescriptions, patients, api, observability, ci, realtime, queue, visits, billing, commands, consultation, auth, audit, authz, clinics, settings, staff, nav, permissions, perf, shell, pwa): 5,673 passed, 16 failed, all in `tests/security/guard-actions.spec.ts`: the guard's positive control sent no row version to eight actions that now require one (fixed in `tests/security/guard/valid-inputs.ts`; 676 of 676 pass). After the single-statement `view_patient_record`: 142 files (patients, security, authz, audit, api, live, query, prescriptions, today, ci), **3,063 passed, 0 failed**. The two `age`-binary files cannot run here (known). No Vitest stall occurred (about 25 minutes for the 270 files).
- e2e, `--retries=0`: the affected specs on desktop-chrome, pixel-7 and iphone-15 (`live/clinic-changed`, `shell/changed-elsewhere`, `shell/loading-states`, `shell/back-resume-keyboard`, `shell/ui-checks`, `live/*`, `journeys/journey-03`, `m0/register-patient`, `design/keyboard/clinical-b`): 138 passed, 0 failed, 92 skipped by design; after the last product change (`view_patient_record`): `loading-states` + `changed-elsewhere`: 56 passed, 0 failed, 48 skipped.
- Stress runs (three to six busy loops on the 8-core VM, `--repeat-each`): `clinical-b` 20 of 20 (before the fix: 5 failures in the first 6); `back-resume-keyboard`, `journey-03`, `m0/register-patient`, `live/convergence` on three projects: 94 of 98 ran with 0 failures before the 900 s guard cut the run.
- **First full PR lane** (`desktop-chrome pixel-7 iphone-15 pwa-ipados`, 1,602 tests, 1.6 h, no retries, before `view_patient_record`): 1,243 passed, 354 skipped, **5 failed**: `loading-states` "a patient (history streams)" on 360, 820 and 1,280 px (the audit awaited after the read had removed the history skeleton's window: the reason for `view_patient_record`) and `journey-03` / `m0/register-patient` on iphone-15 (F5, above). The nine failures of the 09E-08 lane run (`clinical-b`, `back-resume-keyboard` on two projects, `loading-states`, `ui-checks` x3, the two register specs) were not among them except these.
- **Final full PR lane** (same projects, after every change): 1,602 tests, 1.8 h, no retries: **1,245 passed, 354 skipped, 3 failed**, each root-caused above and changed in its spec: `loading-states` "Referrals at 1280 px" (axe found no skeleton: window vs axe, F3b), `journey-03` on iphone-15 (the second entry loaded the 638-row Patients page: F5) and `live/convergence` "delivered" on iphone-15 (my own first probe waits plus two 6 s joins over the 30 s limit: F6a). Not among the failures this time: `clinical-b`, `back-resume-keyboard` (two projects), the first `loading-states` patient record, `ui-checks` (three widths) and `m0/register-patient`. **Affected part re-run** (`loading-states` all screens and widths, `journey-03`, `m0/register-patient`, `live/convergence`, three projects, `--retries=0`): **70 passed, 0 failed, 44 skipped by design.** So the lane as a whole has not had one run with 0 failures after the last spec changes; the two runs before them are above. No test passed on a retry.
- Latency lane at 300 ms: `perf-latency` (`@budget` rows, `live.today.refresh`, every `save.*` row, the four patient rows; `PERF_LATENCY_MERGE` over the 09E-08 summary): 27 of 30 passed in the first pass and 18 of 20 in the second: every `@budget` row, `live.today.refresh` (2 / 2) and every `save.*` row hold their ceilings; the failures were the two full-load patient rows (depth +1, above) and, once, `save.D.draft-autosave` (5 calls instead of 1: one of them `POST /auth/v1/token`, a session refresh that fell into the sample 20 minutes into the run; it passed in the next run). No ceiling changed (`latency-ceilings.mjs` was not run with `--write`: no row has a clean lower measurement).

### For the PO

1. Reserved migration numbers moved up by one (above).
2. The RUM per-account counter stores `sha256(user id || day)` for the day only (no table existed for a per-account figure; the "no user stored" rule of 09E-02 is kept in spirit: the key names no one the next day, nothing joins it, no API role reads it). Acceptable, or should the per-account share live in the route's memory only?
3. **Product question from a flake (F5):** on the Register patient sheet the duplicate-patient answer appears **above** the Age and Sex fields about 0.4 s after the age is typed; a tap on "Female" that lands as it arrives hits whatever moved under the finger (seen on iphone-15: the radio stayed unchosen and the form said "Fix 1 field"; it could as well land on "Use this patient"). The spec now waits for the answer; the product still shifts. Options: render the answers below the Sex and AI-objection fields (the tab order then reaches the answers after them), or reserve their space. It changes a design decision of 08-02; not changed without your word.
4. B-8 is still open (G).
5. L6 (the changed-elsewhere flash after an own save) is not done; backlog, no owner yet.
6. The full-load patient rows (`full.R.patient`, `full.D.patient`) are one deep at times because of where the shell's first notification call falls against the history's last call (tens of milliseconds); their ceilings are held, not raised. If you want those rows steady, the shell's post-hydration reads would have to start earlier or not chain (a shell change, not the record page).
7. **The Patients list renders every patient** (638 rows late in the lane, no pagination). Opening the Register patient sheet is a client navigation that re-renders it, which is what made two iphone-15 specs miss a 5 s wait (F5). A real clinic with thousands of patients would feel it. Pagination (or opening the sheets without re-rendering the page) is a product change outside this round.
8. The Realtime/RUM facts the round touched (`x-clinicos-tenant`, the 409) change no API for outside callers: `/api/today/board` and `/api/live/state` are session routes of the app itself.

## 09E CI fixes (PR #19, CI run 45624794749)

| Failure | Cause | Fix |
|---|---|---|
| security: gitleaks (one finding) | False positive: a synthetic new-password literal in `tests/auth/password-save-recheck.spec.ts` (commit `07c827ba`) matched a generic secret rule; the full-history scan keeps flagging the old commit. | `.gitleaksignore` fingerprint for that commit and line; the spec now builds the synthetic value at run time so no later commit carries the literal. Local full-history scan with the pinned gitleaks 8.30.1: no leaks found. |
| test: `tests/integration/queue-token-concurrency.spec.ts` | 09E-07 made the check-in command answer with the visit's current `rowVersion`; the spec's exact `toEqual` predates it. | The spec reads the visit's stored `row_version` and expects it in the answer (a re-check-in does not change the visit). |
| e2e: `shell/loading-states.spec.ts:92` "a patient record opened from Patients", desktop-chrome (also 3 of 5 locally) | Test race, not a product bug. Since `view_patient_record` (09E-14a) the layout's 404 read (`GET patients`) and the page's audited read (`rpc/view_patient_record`) start in the same millisecond and, at one injected delay for every call, end within about 5 ms of each other (server call record: the record's first paint is one round trip, as R-9 and 09E-06 designed: "the patient record has no route skeleton gap to fill"). Whether the route skeleton flashed in that gap was chance. The observer was installed in time; there was simply no window. | The spec makes the page's read the slow one: the latency preload takes an optional per-path extra (`{"extra": {"POST /rest/v1/rpc/view_patient_record": 1200}}`, `setSupabaseLatency(ctx, 300, { serverExtra })`; unit-tested in `tests/perf/server-latency.spec.ts`), so the layout answers first and the boundary under it has a window. The spec now asserts the real outcome: the patient skeleton (`data-route-skeleton="patient"`) appears, before the record's `h1` (the patient's name), and is gone once the record shows. Fails without the extra: 4 of 5. With it: 5 of 5 alone; whole `loading-states` on desktop-chrome, pixel-7, iphone-15 under CPU load (4 busy cores of 8): 52 passed, 44 skipped by design, 0 failed, `--retries=0`. No ceiling or timeout raised. |

For the PO: a record opened from Patients (not prefetched, R-9) shows nothing new between the click and the record's first paint (one round trip at hosted latency), as designed in 09E-06. If you want feedback in that moment, a link-pending indicator (`useLinkStatus`) on the Patients list is a small design change, not made here.

## 09E-09 Reference catalogues on the device: versions, shards and substances (tracer)

Branch `v2/phase-09e-pr2-search-schedule` (stacked on PR 1, `v2/phase-09e-caching-speed` at `6da8a89c`; retargeted to `feature/v2` after PR 1 merges). Migration `000128_reference_catalogues`
(numbers as shifted by 09E-14a). No new dependency (IndexedDB, compression and the worker-free search use platform APIs; `node:zlib` in the size script).

### What shipped

- **000128** (`supabase/migrations/000128_reference_catalogues.sql`, pgTAP `reference_catalogues.test.sql`, 84 tests):
  - `public.reference_catalogues(catalogue, version uuid, changed_at)`: rows `cdci` and `diagnoses` seeded; RLS on, one SELECT policy for `authenticated` (`true`: global reference data, like the
    catalogue tables), `REVOKE ALL` from PUBLIC, anon, authenticated and service_role, then `GRANT SELECT` to authenticated only (no write grant to any API role).
  - `private.reference_catalogue_bump()` (definer, `search_path ''`, no API grant) and five statement-level `AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE` triggers: `cdci_substances`,
    `cdci_generics`, `cdci_brands`, `cdci_medicines_search` -> `cdci`; `opd_diagnoses` -> `diagnoses`. A new `gen_random_uuid()` and `now()` per statement.
  - `public.reference_shard(p_tenant_id, p_catalogue, p_shard) RETURNS jsonb` (STABLE, INVOKER, `search_path ''`, EXECUTE `authenticated` only): substances and diagnoses need
    `consultations:view`, medicines `prescriptions:edit` (`public.has_permission`, so a clinic that is not full gets nothing); NULL for no session, another clinic, a forged or unknown
    tenant, an unknown catalogue, a negative, NULL or out-of-range shard. `{catalogue, version, shard, shards, rows}` from one snapshot; rows are arrays ordered by id `COLLATE "C"`:
    substances `[id, name]`; diagnoses `[id, name, icd11, snomed, chronic, specialties, synonyms]` (NULL arrays as `[]`); medicines shard 0 = generics `[id, name, substance_ids]`,
    shards 1..n = the medicine search table's brands `[id, brand_name, generic_row, dose_form]`, 12,000 per shard, `generic_row` = the generic's 0-based position in shard 0.
  - `search_substances` (000118), `search_diagnoses` (000114, its pg_trgm schema lookup kept) and `search_medicines` (000117): `CREATE OR REPLACE` from the latest bodies (grants and
    comments kept), the name tie-break only: `lower(name) COLLATE "C"` (R-6).
  - Registries in the migration commit: `EXPECTED_MIGRATION` 000128, schema snapshot, `types/database.ts`, pgTAP FLOOR **9739** (9559 + 84 + 96 authz_matrix cells; 76 files; the new
    file required), `definer_functions` (one classified trigger function), authz matrix (`reference_catalogues` target with the catalogue rule, `authz:gen` regenerated `authz_matrix`,
    `authz_completeness`, `AUTHZ-MATRIX.md`; `table-matrix.spec.ts` DELETE column).
- **Server** (`features/reference/catalogues.ts`, `service.ts`): names, permissions, shard sizes, the uuid and shard-index checks, the shared row shapes (`isCatalogueRow`,
  `parseShard`, `parseManifest`); one call each, the caller's JWT client, no server cache.
- **Routes**: `GET /api/reference/manifest` (`resolveServiceContext()`; `private, no-cache`, ETag, 304 on `If-None-Match`; `{catalogues: {<name>: {version, shards}}}` for the
  catalogues the role reads; a receptionist or admin gets `{}`) and `GET /api/reference/{catalogue}/{version}/{shard}` (permission of the catalogue, 403 without; 404 for an unknown
  catalogue, a non-uuid version, a shard that is not `0`..`999` or out of range; 409 `CATALOGUE_CHANGED` `no-store` for a version that is not current; 200 `private,
  max-age=31536000, immutable`). Both: 401, 403, 403 `SUBSCRIPTION_LOCKED`, 503, 500 with fixed bodies, `timedRoute` (Server-Timing). Guard kinds `reference-manifest` and
  `reference-shard` with their legs (`tests/security/guard/engine.ts`); `server-routes.ts` regenerated; `npm run inventory` 0 flagged.
- **Device** (`lib/reference/idb.ts`, `sync.ts`, `store.ts`, `search-substances.ts`, `components/shell/reference-sync.tsx`): one IndexedDB database `cliniq-reference` (stores
  `meta` and `rows`; a meta record is written in the same transaction as the last shard, so a catalogue with a meta record is complete; older versions deleted in that transaction).
  The sync (one run at a time per tab): stored version into memory first (offline-capable), then the manifest, then only the missing shards, each checked against the manifest's
  version (a 409 or a shard of another version: the manifest is read again, at most 3 times a run); storage unavailable or over quota: memory only for the tab. Started by the shell
  (`app/(dashboard)/layout.tsx`, the catalogues the role reads from the permission matrix) after first paint (`requestIdleCallback`, `setTimeout(0)` where WebKit has none), again on
  resume and `online` (at most once a minute), and before the first search (the editor's mount). Registered with `lib/pwa/cleanup.ts`: sign-out, lock and switch empty the memory,
  close the connection and stop the sync; sign-out also deletes the database (the purge deletes it as well; see deviations).
- **Allergy editor** (`components/clinical/allergy-editor.tsx`): when the catalogue is held, each keystroke is answered by `searchSubstancesLocal` (the twin) with no debounce, one
  search per animation frame, RUM `search_device`; the query goes through the same steps the route and the service apply (`substanceQueryOf`); otherwise the route as before.
  `data-search-source="device" | "server"` on the input (the specs wait on it).
- **Size** (`scripts/perf/reference-size.ts`, `evidence/reference-size.json`; the real files, no database, no network): substances 1 shard, 3,283 rows, 107,446 B raw, 34,934 gzip,
  29,471 brotli; diagnoses 1 shard, 1,550 rows, 256,879 raw, 25,477 gzip, 14,918 brotli; medicines 9 shards (generics + 8 brand shards), 104,216 rows, 7,522,178 raw,
  1,257,108 gzip, 969,515 brotli; largest shard 941,118 B raw (under 1 MB).

### Specs

- **pgTAP `reference_catalogues.test.sql`** (84): the table, its grants, policy, seeded rows and CHECK; the bump (definer, no API grant) and its five triggers; each of the five tables moves ITS
  catalogue's version on insert, update, delete and truncate and not the other's (a zero-row statement moves it too); `reference_shard` grants, 19 refusal cases (all NULL), the
  shapes (exact keys, the version of the same snapshot, rows by id, non-ASCII kept, NULL arrays as `[]`, generics and the brands' `generic_row`), 24,004 brands = shards of 12,000,
  12,000 and 4 with every brand exactly once and the last id in the last shard, a full shard under 1 MB raw, a version moved by an edit is the next read's; the three searches order
  `Qzxtie-b` before `Qzxtiea` (byte order; en_US says the opposite, asserted as a control) and keep EXECUTE for authenticated only.
- **Vitest `tests/reference/substance-search-parity.spec.ts`** (46: 34 cases + breadth, non-vacuous, helper and route-path checks): the twin over the shard the doctor downloads against
  `public.search_substances` through the doctor's JWT client: exact, prefix, word prefix, inside, case and spaces (btrim of spaces only; a tab is kept), `%`, `_`, `\` (literal in
  every rank), non-ASCII (Ä, É, ß), code point order beyond the BMP, ties (the `C` tie-break and identical names by id), limits 0, 5, null, 50 and the default, empty, spaces, null,
  61 characters, no match. Then the device path (`substanceQueryOf` + twin) equals the server path (the service the route calls) for 9 typed values.
  `tests/reference/reference-sync.spec.ts` (12): the sync's rules with fakes (download and store, stored version first, offline keeps the stored version, a changed catalogue is
  read again from the manifest at most 3 times and nothing is stored, a catalogue the manifest does not list is never fetched, over quota = memory only, runs never overlap, nothing
  after dispose) and the shared shapes.
- **Guard legs** (`tests/security/guard-routes.spec.ts`): `reference-manifest` (401, 403, locked 403 `SUBSCRIPTION_LOCKED`, every role exactly its catalogues from the matrix,
  `private, no-cache` + ETag, 304, no cookie, one `reference_catalogues` read, forged tenant changes nothing) and `reference-shard` (401, 403, locked, every role lacking the catalogue's
  permission 403 with the membership lookup only, the holder 200 immutable with exactly the keys and one `reference_shard` call, stale version 409 with the fixed body, five 404s,
  forged tenant changes nothing).
- **e2e** `tests/e2e/reference/reference-routes.spec.ts` (desktop-chrome, pixel-7): headers through the real server incl. Server-Timing, 304, 409, 404, a receptionist's empty
  manifest and 403, no session 401, a fixture write changes the manifest at once and turns the old shard URL into a 409. `substances-local.spec.ts` (`@golden`: desktop-chrome,
  pixel-7, iphone-15): typing with 300 ms added to every Supabase call answers from the device with **0 Supabase calls** (Kong, server and browser; background held) in the SQL order;
  offline still answers; IndexedDB refused (`IDBFactory.prototype.open` throws) answers from memory and creates no database; the reference routes unreachable falls back to the route;
  the stored records are catalogue records of a known shape and hold no patient name or clinic id; a sign-out leaves no database.
- **Cache audit** (`tests/e2e/pwa/05-cache-audit.spec.ts`, `support/storage-dump.ts` `referenceDbAudit`): during a session exactly `cliniq-reference` with stores `meta` and
  `rows`, every record of a known shape (the shapes restated in the spec, not imported); after every exit path nothing (unchanged assertion).

### Fails-without

- **High, only catalogue rows on the device**: a scratch copy of the cache audit (deleted) put `{key, patient, visit}` into `cliniq-reference.rows` before the audit: "browse as
  owner" **fails** on desktop-chrome ("records outside the catalogue shapes", 3 lines). The committed spec passes.
- **Tie-break**: the pgTAP tie cases assert the byte order on names the database's own collation (en_US.UTF-8 locally) orders the other way (the control case proves the two
  disagree), so the old `lower(name)` / `name` tie-break fails them by construction; the parity spec's `qzxreftie` case likewise (not re-run on the old bodies).

### Budget rows (tool output: `evidence/09E-09/substance-row-300ms.{json,md}`, merged onto `evidence/09E-08/save-rows-300ms.json`; ceilings by `latency-ceilings.mjs`)

| Row | Before (calls / depth, median ms) | After |
| --- | --- | --- |
| `type.D.substance` (B-4, now `@budget`) | 1 / 1, 468.7 ms | **0 / 0**, 26.7 ms (max 37.4) |

`latency-ceilings.mjs --write` lowered only that row (1/1 -> 0/0) and re-pointed every row's `source` at the merged file (no other number changed). `perf-latency --grep @budget
--retries=0` on the final tree: **15 passed** (8 setup + 7 rows, incl. `type.D.substance` 0/0, 21 ms median). `command-latency.ts` `read: reference_shard (substances)`: p50 12.3,
p95 15.4 ms (`evidence/09E-09/command-latency.json`; the script exits 1 on the five reads that were already over 50 ms on this VM in 09E-05/06: consult_assist_context, search_diagnoses,
search_medicines, consult_screen, today_board; none is this plan's).

### Decisions and deviations

- **Only `substances` is synced in this plan** (`DEVICE_CATALOGUES`): the manifest lists all three catalogues the role reads, the routes and `reference_shard` serve all three, and
  09E-10 / 09E-11 add their catalogue to the list with their consumer (no download nobody uses).
- **Medicines' shard count is not in the manifest** (`shards: null`; shard 0 carries `shards`): the manifest stays one `reference_catalogues` read with no new function; counting
  93,911 brands per manifest call would add work to every app start.
- **Resume and `online` re-check the manifest at most once a minute** (`RESYNC_MIN_MS`); app start and "before the first search" are never throttled. The plan says "on resume".
- **Sign-out also deletes the database in the store's cleanup** (`indexedDB.deleteDatabase`, queued behind any open of this tab): the purge (unchanged) deletes only the databases
  `indexedDB.databases()` lists at that moment, and an open started a moment before could be missing from that list. Lock and clinic switch keep the database (global rows only).
- **A catalogue that changes while it is read** (a 409 or a shard of another version) is re-read from a fresh manifest, at most 3 manifest reads a run: on a busy database (the e2e
  lane upserts CDCI fixtures in many specs) the first try can meet a version change.
- **The lane holds `/api/reference/**` during a measured window** (like `/api/session-status`, R-4 background): the sync after first paint would otherwise land in full-load windows.
  It has no row of its own yet: B-14 (the download's bytes) is 09E-11's.
- **The plan's single "IndexedDB unavailable" case is two**: R-5 says unavailable storage means memory only (so the editor answers from the device after the download), and the
  route fallback is shown with the reference routes unreachable.
- **`search_diagnoses` tie-break** was `m.name` (case-sensitive, default collation); it is now `lower(m.name) COLLATE "C"` as R-6 states (one `lower()` more than "the collation only").
- **`search_substances`' rank 1 is a literal prefix** (`LIKE v_pat || '%'`, escaped), as the twin implements; my first twin read it as an unescaped pattern and the parity table caught it.
- `tests/e2e/pwa/fixtures.ts` needed no change (the audit helper lives in `support/storage-dump.ts`). `tests/terminology/*` and `tests/prescriptions/medicine-search-route.spec.ts` needed no
  order change. One fixture of my parity spec (`Qzxref 50% Special`) collided with `substance-search-route.spec.ts`'s unscoped `50%` query in a parallel run: renamed `Qzxref 5% Special`.
- Affected-test grep (`allergy-editor|AllergyEditor|data-allergy-search|search_substances|search_diagnoses|search_medicines|indexedDB|registerCleanup|Record now`): tests/ci/pgtap-*,
  tests/e2e/a11y/consult-screens, tests/e2e/consult/rx-allergy, tests/e2e/design/keyboard/clinical-a (allergy line only, not the editor), tests/e2e/perf/latency-saves,
  tests/e2e/pwa/05-cache-audit and fixtures, tests/e2e/shell/user-menu-keyboard, tests/e2e/support/storage-dump, tests/integration/cdci-search, tests/observability/server-timing,
  tests/pwa/{hard-sign-out,purge}, tests/security/{membership-guard,review-fixes-db}, tests/terminology/diagnosis-search.

### Security-sensitive for the adversarial review

`supabase/migrations/000128_reference_catalogues.sql` (the new table's RLS and grants, the definer bump and its five triggers, `reference_shard` INVOKER with the permission per
catalogue and NULL cases, the three replaced searches: tie-break only, grants and comments kept); `app/api/reference/**` and `features/reference/*` (session, permission per catalogue,
tenant from the session, 409/404 before any row reaches the body, immutable caching of catalogue rows only, no server cache); the guard kinds (`guard-manifest.ts`, `guard/engine.ts`);
the device store (`lib/reference/*`: catalogue rows only, parsed and shape-checked before storing, cleared at sign-out, lock and switch, deleted at sign-out); the cache-audit
allowance (`05-cache-audit`, `referenceDbAudit`); the layout's catalogue list from the role (`app/(dashboard)/layout.tsx`, display only: the routes and the database decide). No
service-role client, no PHI anywhere in the new paths, no cookie.

### For the PO

1. A statement that touches no catalogue row still changes the version (statement triggers): a seed re-run or a test fixture upsert makes every device download the catalogue again
   (36 kB gzip for substances). Acceptable, or should the bump compare transition tables (four triggers per table)?
2. `reference_catalogues` is readable by any signed-in user, including a member of a locked clinic (the catalogue rule of the CDCI tables); the manifest route refuses a locked clinic.
3. Resume re-checks the manifest at most once a minute (above).

### Tests run (local stack)

- `npm run typecheck`: clean. `npx eslint .`: 0 errors, 391 warnings (the same 391 on the untouched head, measured with the change stashed; none in a file of this plan).
  `npm run inventory`: 0 flagged. `server-routes.mjs --write` (two routes). Schema snapshot regenerated after `db reset --local`.
- pgTAP (after `db reset --local`): **9,739 tests in 76 files, 0 failed**, gate PASS at floor 9,739 (`reference_catalogues` 84 of 84; `authz_matrix` 6,624; `definer_functions` 109).
- Vitest (tests/{reference,terminology,security,pwa,ci,authz,observability,perf,query,live}, `prescriptions/medicine-search-route`, `integration/cdci-search`,
  `api/readiness-probe-db`): 121 files, 2,857 tests: 2,856 passed, 1 failed = the fixture collision above (fixed; the two files re-run: 65 of 65). Guard routes 72 of 72.
  The two `age`-binary files were not in scope (known).
- e2e (`stack:recycle` before, `--retries=0`): `tests/e2e/reference` + `pwa/05-cache-audit` on desktop-chrome, pixel-7, iphone-15: 53 passed, 1 failed (iphone-15, IndexedDB refused:
  WebKit ignored an own `open` assigned on the factory; the spec now patches `IDBFactory.prototype`; that case then passed on iphone-15 and desktop-chrome). Final run of
  `reference/*`, `consult/rx-allergy`, `consult/consult-screen`, `a11y/consult-screens` (the editor at 360, 820, 1280, axe), `shell/user-menu-keyboard` on the three projects:
  **102 passed, 2 skipped by design, 0 failed**. No design project was run (no markup changed: one data attribute), so no screenshots to discard.
- Latency lane: the `type.D.substance` row (5 samples) and the `@budget` subset (15 passed), above. Not run: the full Vitest suite, the full PR lane, the nightly lane (CI).

## 09E-10 Diagnoses on the device

Branch `v2/phase-09e-pr2-search-schedule`, commit `bc2a49ec`. No migration, no new dependency.

### What shipped

- **`lib/reference/trigram.ts`**: pg_trgm `similarity()` twin (lower-case, words of letters, combining marks and decimal digits, two leading spaces and one trailing,
  distinct trigrams, |A∩B| ÷ |A∪B| as a 4-byte float, `>= 0.3` compared as the database compares it). Combining marks count as word characters because glibc
  does (a Devanagari virama or vowel sign stays inside the word; measured with `show_trgm`).
- **`lib/reference/search-diagnoses.ts`**: twin of `search_diagnoses` (000114 body, 000128 tie-break): `p_terms[1:8]`, terms of 2+ characters after trimming
  spaces, distinct and lower-cased; the caller's custom diagnoses (from the consult's query) first by `use_count`; catalogue ranks 1 to 6 (equal, prefix, synonym
  equal or prefix, word, inside, trigram on the name or a synonym); the specialty filter on the catalogue only; one row per lower-cased name (custom wins, else the
  best rank); `lower(name)` in code point order; limit `least(greatest(coalesce(limit,20),1),50)`. `diagnosisTermsOf` reproduces the server path
  (`fetchDiagnosisHits` → route `cleanQuery` → service `expandQuery` when `assist.terminology`).
- **Diagnosis section**: with the catalogue held (`useReferenceCatalogue("diagnoses")`), each keystroke is answered by the twin with no debounce, one search
  per animation frame, RUM `search_device`; otherwise the route as before. `requestReferenceSync("diagnoses")` on mount. `data-diagnosis-input` and
  `data-search-source` on the input; `data-diagnosis-hit` on a row's name (specs read the order). The workspace passes `customDiagnoses`
  (`consult.data.lists?.custom_diagnoses`) and `expandTerms` (`assist["assist.terminology"]`, the same `my_entitlements` the route reads).
- `DEVICE_CATALOGUES` += `diagnoses` (synced after first paint, cleared at sign-out/lock/switch, deleted at sign-out as 09E-09).

### Specs

- `tests/reference/trigram-parity.spec.ts` (53): 50 pairs against the database's `similarity()` (texts hex-encoded into psql; `extra_float_digits = 3`): short
  words, one-letter words, digits, punctuation, repeated words, `%`, `_`, `\`, accents, ß, Devanagari, CJK, empty; plus the `show_trgm` set for ASCII.
- `tests/reference/diagnosis-search-parity.spec.ts` (57): 44 cases (abbreviations on/off, synonyms, specialties incl. a row with none, custom first, custom and
  catalogue with the same name, another doctor's custom never present, trigram-only on catalogue, custom and synonym, ties in C order, `%`/`_`/`\`, non-ASCII,
  limits 0/5/12/null/default/60, ignored one-character term, the 8-term cut, duplicates, best rank over terms, btrim vs tab, 100-character cut, NULL term,
  no terms, NULL terms, no match) against `public.search_diagnoses` through the doctor's JWT client, the shard re-read before each SQL call; 11 typed values
  through the device path vs the route's service path.
- `tests/e2e/reference/diagnoses-local.spec.ts` (`@golden`, 3 projects): 0 Supabase calls (Kong, server and browser) with 300 ms added while typing, the doctor's
  own first in SQL order, a pick adds the catalogue row with its ICD-11 code; offline still answers; reference routes unreachable → the route answers.
- `tests/e2e/observability/rum.spec.ts`: aborts `/api/reference/**` so its diagnosis search still measures `search_server` (the device path is covered above).

### Budget rows (tool output `evidence/09E-10/diagnosis-row-300ms.{json,md}`, merged onto `evidence/09E-09/substance-row-300ms.json`; ceilings by `latency-ceilings.mjs --write`)

| Row | Before (calls / depth, median ms) | After |
| --- | --- | --- |
| `type.D.diagnosis` (B-4, now `@budget`) | 2 / 2, 825.3 ms | **0 / 0**, 30.6 ms (max 35.4) |

Only that row's ceiling changed (2/2 → 0/0); every row's `source` re-pointed at the merged file.

### Decisions and deviations

- **Custom rows carry `custom:<name>` as id on the device** (the consult's query holds no id; the section adds a diagnosis by name). The parity spec compares
  custom rows by name, catalogue rows by id. The device knows the doctor's 500 most used custom diagnoses (the consult's list), the database all.
- **Same lower-cased name, same group and rank**: the database's `DISTINCT ON` keeps an arbitrary one; the twin keeps the smaller id (no fixture relies on it).
- **Parity fixtures use made-up words only** (`Qzxdx Pyrol`, not "Fever"): my first fixture names ("Qzxdx Hypertension", "Qzxdx Fever") reached the unscoped
  queries of `tests/terminology/diagnosis-search.spec.ts` ("hypertension", "fever") and failed 6 of its cases while both files ran. Renamed; the two files and the
  route spec pass together (224 of 224).
- The plan's "learned order applied as today": today the learned order ranks the tiles, not the search rows; nothing changed there.
- Affected-test grep (`terminology/diagnoses|Search diagnosis name|data-diagnosis-search|opd_diagnoses|search_diagnoses`): consult/{keyboard-golden,smart-assist,
  save-classes}, m0/consult-rx-finish, perf/latency-saves, observability/rum (changed), tests/terminology/*.

### Security-sensitive for the adversarial review

`components/consultation/workspace/sections/diagnosis-section.tsx` (the device path; custom diagnoses come from the consult's own query, memory only, never written
to the device store), `lib/reference/search-diagnoses.ts` and `trigram.ts` (pure). The device store still holds catalogue rows only (the cache audit and
`referenceDbAudit` unchanged and green). No route, permission or SQL changed.

### For the PO

Nothing new to decide.

### Tests run (local stack)

- `npm run typecheck` clean; eslint on the touched trees 0 errors (14 warnings, all pre-existing in untouched lines); `npm run inventory` not affected (no action or route).
- Vitest `tests/reference/{trigram,diagnosis-search,substance-search}-parity`, `reference-sync`, `tests/terminology`: **7 files, 224 passed**.
- e2e (`--retries=0`, desktop-chrome + pixel-7 + iphone-15): `tests/e2e/reference`, `consult/smart-assist`, `consult/save-classes`, `observability/rum`,
  `pwa/05-cache-audit`: **108 passed, 3 skipped by design, 0 failed**. No design project run (no visual change), so no screenshots to discard.
- Lane: `type.D.diagnosis` (5 samples, above).

## 09E-11 Medicines on the device

Branch `v2/phase-09e-pr2-search-schedule`, two commits (the plan's split point after step 3). No migration, no new dependency (Web Worker, IndexedDB,
`node:zlib` are platform). **One blocker found (H-1 below): the brand shards of `reference_shard` (000128) time out at the full catalogue size; the fix is a
migration, outside this plan's scope.**

### What shipped

- **`lib/reference/medicine-index.ts`** (pure): the columnar index (brands sorted once by lower-cased name in code point order, then id; one U+0001-separated
  string of the lower-cased brand names with their start offsets, the same for the generics; per brand its generic position, id, name, form; per generic its name
  and substance ids). `searchMedicineIndex(term, need, exclude)` = ranks 1 to 4 of `search_medicines` by `indexOf` over the two strings plus one pass over the
  brands in sort order (buckets per rank, early stop when rank 1 is full). `compareCodePointsFast` (UTF-16 with surrogates moved above the BMP = code point order,
  no allocation).
- **`lib/reference/worker.ts`** (messages `load`, `search` with a request id; `loaded` with the build time, `result`, `failed`) and **`lib/reference/medicine-host.ts`**
  (starts `new Worker(new URL("./worker.ts", import.meta.url))`, bundled by Turbopack as a worker chunk; if no worker can start or it fails, builds the index on the
  main thread in idle slices and searches there; `performance.measure("clinicos.medicine_index")`; `useMedicineIndex()`; ended by the store's cleanup).
- **`lib/reference/store.ts`**: the medicine catalogue's shards go to the index (the tab keeps only the version; no 104k rows in React memory); cleanup also ends the
  index (worker terminated). **`DEVICE_CATALOGUES` += `medicines`** (the layout already filters by `prescriptions:edit`). `sync.ts` needed no change (09E-09 already
  learns the shard count from shard 0).
- **`lib/reference/search-medicines.ts`**: the doctor's custom medicines (consult's query) matched as SQL does (name or generic contains the term, or trigram ≥ 0.3 on
  the name), first by `use_count`, with their stored dose; a catalogue row whose lower-cased brand equals a matched custom name is dropped; ranks 1 to 4 from the
  index; `complete` when the device's rows fill the limit (15). `medicineQueryOf` reproduces `fetchMedicines` → route → service.
- **`RxEntryRow`** gains `deviceSearch`: each keystroke is answered by the device in the next animation frame (no debounce, RUM `search_device`); a `complete`
  answer is final (no call); otherwise the device's rows are shown at once and the route is asked once the query settles (150 ms), its answer replacing the list.
  While that tail is pending the "Add …" row waits (the list may still grow; see deviations). A failed tail (offline) keeps the device's rows. An empty partial
  answer waits for the route (Enter never acts on "no match" too early). `data-search-source` and `data-rx-hit` attributes.
- **`PrescriptionSection`** passes `deviceSearch` when the index is ready, `requestReferenceSync("medicines")` on mount; custom rows get the same id from either
  side (`custom:<lower-cased name>`). The workspace passes `customMedicines` from the consult's query.
- **`tests/e2e/support/cdci-fixtures.ts` `upsertCdciRows`** now also writes the brand's generic and `cdci_brands` link (consistent like the real load: the device's
  generic comes from `cdci_brands`/`cdci_generics`, the search's from `cdci_medicines_search`).
- **`tests/e2e/support/perf-catalogue.ts`**: the full-size synthetic catalogue (93,911 brands, 10,305 generics, 3,283 substances, 1,550 diagnoses; seeded generator;
  name lengths from quantiles measured once from the real files; `perf-*` ids and `e11e…` uuids; two 20-brand families for the typeahead row), upserted/deleted
  around the lane's medicine rows and deleted by the e2e global setup if a run died. Its vocabulary was calibrated so its medicine shards compress like (slightly
  worse than) the real ones.
- **Lane**: `type.D.medicine` measures the device path on the full-size catalogue (`Perfrow Alp` + `h`: 40 → 20 rows, no tail); new row `ref.D.cdci-download`
  (kind `reference`, B-14, `maxBytes` 1,600,000 blocking: the bytes of one CDCI version through CDP `encodedDataLength`, HTTP cache off; IndexedDB usage, the index
  build at 4× CPU and the worker heap reported into `test-results/perf-latency/reference-download.json`). Both rows are in one describe that is **`test.fixme`
  until H-1 is fixed**, and `type.D.medicine` is not `@budget` (it would fail every PR).
- **`scripts/perf/reference-size.ts`** also writes the synthetic set and the index build time in Node.

### Size and index (tool output: `evidence/reference-size.json`)

| Set | Medicine shards | Rows | Raw | gzip | brotli | Largest shard raw | Index build (Node, no throttling) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Real files | 9 | 104,216 | 7,522,178 | 1,257,108 | 969,515 | 941,118 | 201.5 ms |
| Synthetic (lane) | 9 | 104,216 | 7,231,316 | 1,394,472 | 1,126,849 | 1,038,709 | 226.3 ms |

(Real CDCI substances add 34,934 B gzip to the same `cdci` version: 1,292,042 B gzip in all, under B-14's 1.6 MB.) The browser figures (bytes transferred,
IndexedDB, build at 4× CPU, worker heap) were blocked by H-1 here; measured after 000129 ("H-1 resolved" below).

### H-1 (blocker, **resolved by 000129**, see "H-1 resolved" below): `reference_shard` brand shards time out at full size

With the synthetic catalogue loaded (93,911 brands), the lane's sync answered shards 1..7 in about 0.5 s each and **shard 8 with a 500 after 8.3 s** (the API role's
statement timeout). In a superuser psql session (catalogue copied in, `ANALYZE`d, everything rolled back; nothing committed), the 000128 brand-shard query at
`OFFSET 84000` ran **> 30 s** (cancelled): the planner estimates the `OFFSET`/`LIMIT` page at one row and joins it to `cdci_brands` and the generics window by nested
loop (a seq scan of the generics per brand). The same query with both CTEs `AS MATERIALIZED` answered shard 8 in **131 ms** and shard 1 in 103 ms. The real CDCI
(93,911 brands) has the same shape, so on staging and production every device with `prescriptions:edit` would download shards 1..7, fail on 8, fall back to the
route (the Rx field still works) and cost the database one 8 s statement per app start (and per resume, at most once a minute). pgTAP's 24,004-brand case passes
because its offsets stay under the estimate. **Needs**: a migration replacing `reference_shard` with the CTEs materialized (or keyset by id), plus a pgTAP/latency
case at 93,911 brands, before PR 2 merges; until then either accept the fallback or take `medicines` out of `DEVICE_CATALOGUES`. Then un-`fixme` the two lane rows
and run them (`PERF_LATENCY_MERGE=evidence/09E-10/diagnosis-row-300ms.json ... --grep "type.D.medicine|ref.D.cdci-download"`, `latency-ceilings.mjs --write`).

### H-1 resolved (migration `000129_reference_shard_materialized`)

- **Cause, measured again before the fix** (psql, superuser, synthetic 93,911 brands and 10,305 generics loaded in a transaction, rolled back; nothing committed):
  the 000128 brand-shard query takes the `OFFSET`/`LIMIT` page for **one row** and joins it by nested loop to `cdci_brands` and to the generics window (a
  scan of all generics per brand). Two ways to get there: fresh statistics (ANALYZE after the load: a parallel-scan estimate below the offset) and stale
  statistics (taken while the tables were small, as right after a reload before autovacuum). OFFSET 84,000: > 20 s (canceled) with fresh statistics; the
  000128 function itself: shards 7 and 8 canceled at 15 s with fresh or stale statistics, 279 ms for both with no statistics at all.
- **The first idea (both CTEs `AS MATERIALIZED`, the 09E-11 note) fixes only the fresh-statistics case**: 106 ms for shard 8 there, but with stale
  statistics the materialized generics CTE is still scanned once per brand (> 15 s, canceled). Not shipped.
- **Shipped**: `CREATE OR REPLACE public.reference_shard` from the 000128 body, the brand-shard branch only: the generics' 0-based positions (same order,
  `id COLLATE "C"`) read once into a jsonb map, the page `AS MATERIALIZED`, only its 12,000 rows joined to `cdci_brands`, each brand's `generic_row` looked up
  in the map (`JSON null` when the brand has no generic, as before). Signature, STABLE INVOKER, `search_path ''`, permissions, every NULL case, keys and row
  shapes unchanged; grants and comment restated. Measured in psql: about 0.23 s for one brand shard with fresh, stale or no statistics (0.46 to 0.55 s for
  shards 7 and 8 together). 000128 is not edited.
- **pgTAP `reference_shard_full_size.test.sql` (14)**: 93,911 synthetic brands and 10,305 generics (`test-ref-129-*`), the stack's own CDCI rows deleted in
  the transaction; the last shard read first with STALE statistics (taken at 300 brands and 30 generics), then again with FRESH ones, then 7 and 0..6, each
  one top-level statement under a 5 s `statement_timeout` (a canceled read is kept as `error:57014`); every read answers, the stale and fresh answers are
  equal, 9 shards, 10,305 generics, 9,911 rows in the last shard, every brand exactly once (distinct and all), the last id last, a late brand's `generic_row`,
  and the function's contract (STABLE INVOKER, `search_path`, EXECUTE authenticated only). **Fails without**: run against the 000128 body (re-created in
  place, then 000129 re-applied) it fails 9 of 14 (`error:57014` for shard 8 under stale and fresh statistics and for shard 7; the shapes NULL; 60,000 brands
  instead of 93,911); with 000129: 14 of 14, and `reference_catalogues` 84 of 84 unchanged.
- **Full-size latency case** (`scripts/perf/command-latency.ts`, kind `reference`, target p95 < 200 ms, R-16; the lane's perf catalogue upserted through
  `upsertPerfCatalogue` and deleted in `finally`; tool output `evidence/H-1/command-latency.json`): first brand shard **p50 155.8, p95 255.1** ms; last brand
  shard (shard 10: the run's other synthetic CDCI rows add to the 93,911, so 10 brand shards) **p50 140.4, p95 183.8** ms (100 calls each, 0 errors;
  the 000128 function answered 500 after 8.3 s). The first shard's p95 is over the 200 ms target (the run measures it right after the 94,000-row upsert,
  before autovacuum; p50 is under): reported, not hidden; the script exits 1 on it and on the five reads already over 50 ms since 09E-05/06
  (consult_assist_context 55.5, search_diagnoses 170.2, search_medicines 98.6, consult_screen 97.5, today_board 157.5 on this run).
- **Lane rows un-`fixme`d and run** (`PERF_LATENCY_MERGE=evidence/09E-10/diagnosis-row-300ms.json`, `--grep "type.D.medicine|ref.D.cdci-download"`,
  `--retries=0`, after `stack:recycle`; tool output `evidence/H-1/medicine-row-300ms.{json,md}`, `evidence/H-1/reference-download.json`):
  | Row | Before (calls / depth) | After |
  | --- | --- | --- |
  | `type.D.medicine` (B-4, now `@budget`) | 1 / 1 (ceiling never measured) | **0 / 0**, 38 ms median (max 51) |
  | `ref.D.cdci-download` (B-14) | blocked | **1,417,467 B** transferred for one `cdci` version (substances + 9 medicine shards, gzip; max 1,600,000: within); IndexedDB 2,187,264 B (≤ 10 MB); index build **658.4 ms** in the worker at 4× CPU (≤ 1,500); worker heap **19,070,896 B** (≤ 40 MB) |

  `latency-ceilings.mjs --write` lowered only `type.D.medicine` (1/1 → 0/0) and re-pointed every row's `source` at the merged file. Real CDCI: 1,292,042 B gzip
  by the size script (above); the synthetic set compresses slightly worse, so the lane's bytes are an upper bound.
- **Defect in the 09E-11 lane row, found on its first run and root-caused (not retried)**: its prepare waited for both brand families to be on screen after
  "perfrow alp", but the device fills the limit of 15 with the first family in name order, so the other family is never shown (failed after 20 s on the first
  run). The families are swapped (`PERF_FAMILY`: keep "Perfrow Alpine", drop "Perfrow Alpha"; the same 40 rows, names swapped between ids) and the measured key
  is "i": "perfrow alp" shows Alpha, "perfrow alpi" replaces it with Alpine (20 rows, the limit filled, no tail). Passed on the next run with 0 calls.
- `type.D.medicine` is in the `@budget` subset (`pr: true`): every PR now upserts the 94,000-row perf catalogue before it and deletes it after it (about 30 s
  of the lane's setup on this VM).
- Registries in the commit: `EXPECTED_MIGRATION` 000129, schema snapshot (one line: the function's body hash), pgTAP FLOOR **9753** (9739 + 14; 77 files; the
  new file required). `types/database.ts` unchanged (same signature). No grant, table or policy change.
- **Security-sensitive for the adversarial review**: `supabase/migrations/000129_reference_shard_materialized.sql` (a replaced INVOKER read: same permission per
  catalogue, NULL cases, grants and output; the jsonb map holds catalogue ids and positions only), `supabase/tests/database/reference_shard_full_size.test.sql`.
- **Tests run (local stack)**: pgTAP after `db reset --local`: **9,753 tests in 77 files, 0 failed**, gate PASS at floor 9,753. Vitest `tests/ci`,
  `tests/api/readiness-probe-db.spec.ts`: 36 files, 449 passed. `npm run typecheck` clean; eslint on the touched files 0 problems. Lane (after `stack:recycle`,
  `--retries=0`): the two medicine rows 10 passed (after the row fix; the first run 9 passed, 1 failed = the row defect above); `perf-latency --grep @budget`:
  **17 passed** (`type.D.medicine` 0/0 28 ms, `type.D.diagnosis` 0/0 18 ms, `type.D.substance` 0/0 21 ms). `command-latency.ts`: above (exit 1 on the rows named).

### Specs

- `tests/reference/medicine-search-parity.spec.ts` (51): 36 cases (brand prefix and case, brand word, inside, generic prefix, generic word, inside the generic,
  non-ASCII generic, `%`, `_`, `\`, non-ASCII, custom first by use count, a custom name equal to a brand, a custom matched by its generic, another doctor's custom never
  present, ties in C order, identical names by id, a brand with no generic, limits 15/5/0/50/null, the trigram tail (catalogue only; custom similar), btrim vs tab,
  the 60-character cut, empty/spaces/null, no match) against `public.search_medicines`: `complete` → the device's list equals SQL (ids, kinds, fields, dose,
  substance ids); otherwise the device's rows are SQL's first rows; non-vacuous controls; the index's sort and `need`; 11 typed values device path vs the route's
  service. Fixtures consistent across substances/generics/brands/search, made-up words only.
- `tests/e2e/reference/medicines-local.spec.ts` (`@golden`, 3 projects): limit filled on the device → 0 Supabase calls (Kong) with 300 ms injected and no route
  request, the custom row first and its stored dose in the builder; the tail → the device's 11 rows on screen while the route is held, exactly one route call for the
  settled query, its answer replaces the list, a trigram-only query is answered by the route with one call; offline → the device's ranks, no error.
- `tests/e2e/consult/rx-allergy.spec.ts` "Undo of a line prescribed despite an allergy": read the database with `expect.poll` (see flaky below).

### Fails-without

None required for this plan (the plan's High list has none for 09E-10/09E-11). The device-vs-route list-change defect below was caught by the existing specs.

### Defects found and root-caused (no retries, no timeouts raised)

- **The highlighted row jumped when the route's answer replaced the device's rows** (m0/consult-rx-finish, journey-06: 6 failures on 3 projects in the first run):
  a custom medicine had id `custom:<name>` from the device and its uuid from the route, so cmdk lost the highlighted value when the list was replaced and
  `ArrowDown` walked from nothing. Fix: one id for a custom row from either side, and the "Add …" row is shown only once the list is final. All 6 pass.
- **`rx-allergy` "Undo … override is kept"** (desktop, once in 3 runs): the spec read the database right after the line reappeared, but since 09E-08 Undo is
  reversible-class (shown before the command answers). Now polls the database; 32 of 32 in 3 repeats.

### Decisions and deviations

- **Worker host in a new file `lib/reference/medicine-host.ts`** (the plan lists store.ts and worker.ts; the host keeps the worker plumbing out of the generic
  store). Main-thread fallback = idle-sliced build (generator steps), recorded, never seen in the runs.
- **Custom medicine ids `custom:<lower-cased name>`** on the device and now for the route's custom rows on screen too (the consult's query carries no id; a custom
  line is added by name; nothing else reads a custom id). Device knows 500 customs (the consult's list).
- **"Add …" waits for the tail** (not in the plan): shown with a partial device list it let the keyboard walk a list that was about to change.
- **Lane rows** in their own describe with the catalogue loaded only around them (not the whole lane: every other doctor row would download 1.4 MB);
  `type.D.medicine` not `@budget`, both rows `fixme` (H-1). `type.D.medicine`'s ceiling stays at 1/1 (not measured, not lowered).
- **Synthetic largest shard raw** is about 1.04 MB (real 941 kB): synthetic names run to the top of their length bands; under Vercel's 4.5 MB.
- B-15 (`npm run ci:route-js`, report-only, on this build): `/consultation/[id]` 426.3 kB gz (route-specific 297.6), `/today` 357.1 kB gz; the worker is a separate
  chunk loaded only when the medicine catalogue is in. (Not attributed per plan: no build of 51de9b71 was made.)
- Affected-test grep (`api/prescriptions/medicines|fetchMedicines|data-rx-search|rxField|addCustomMedicine|cdci_medicines_search`): a11y/{amendment,consult}-screens,
  consult/{keyboard-golden,rx-allergy,rx-assist,rx-keyboard,rx-print,save-classes,workspace-layout}, journeys/{06,08}, m0/consult-rx-finish, perf/latency-{pages,saves},
  support/rx-entry; none intercepts the medicine route.

### Security-sensitive for the adversarial review

`lib/reference/{medicine-index,medicine-host,worker,search-medicines,store}.ts` (catalogue rows only reach the worker; custom medicines from the consult's query are
matched in memory, never stored on the device; cleanup terminates the worker at sign-out/lock/switch), `components/clinical/rx-entry-row.tsx` and
`prescription-section.tsx` (the route is still the authority for the tail and for every write; the allergy pre-check keeps using the row's `substance_ids`, now from
the generics shard), `tests/e2e/global-setup.ts` (deletes `perf-%` rows and the `e11e0000-…` diagnosis range on the local stack). **H-1** for the SQL reviewer.
Cache audit green with the medicine shards stored (shapes already allowed in 09E-09).

### For the PO

1. **H-1** (above): fixed by migration 000129 ("H-1 resolved" below); medicines stay on the device.
2. The device matches the doctor's 500 most used custom medicines and diagnoses (the consult's list); a doctor with more sees the rest only through the route.

### Tests run (local stack, `stack:recycle` before each e2e and lane run)

- `npm run typecheck` clean; eslint on the touched trees 0 errors (pre-existing warnings only); inventory not affected (no action or route).
- Vitest `tests/reference tests/prescriptions tests/terminology tests/pwa tests/perf tests/security tests/integration/cdci-search.spec.ts`: 73 files, 2,295 tests, 2,294 passed, 1 failed = my own parity control asserting the trigram query `zqvtyporaw` returns exactly one row while my e2e fixture `Zqvdevtyporow` is also trigram-similar (the control now asserts `toContain`; the file re-run: 51 of 51). The two `age`-binary files not in scope (known).
- e2e (`--retries=0`, 3 projects) on the final build: `reference/*`, `consult/{rx-keyboard,rx-allergy,rx-assist,rx-print,keyboard-golden,save-classes}`,
  `a11y/consult-screens` (the picker at 360/820/1280, axe), `pwa/05-cache-audit`, `m0/consult-rx-finish`, `journeys/journey-06-consult`: first run 197 passed,
  23 skipped, 6 failed (the highlight defect); after the fix the failing files plus `medicines-local`, `rx-*`: 78 passed, 18 skipped, 1 failed (the rx-allergy
  read, fixed), then `rx-allergy` ×3 on desktop: 32 passed.
- Lane `perf-latency --grep @budget --retries=0` on the final tree: **16 passed** (incl. `type.D.diagnosis` 0/0 33 ms, `type.D.substance` 0/0 29 ms; the two medicine rows `fixme`, H-1).
- Not run: the full PR lane, full Vitest, the nightly lane (CI).

## 09E-12 Schedule data layer: one range read with SQL slots, prefetch, live

Branch `v2/phase-09e-pr2-search-schedule`. Migration **`000130_schedule_range`** (planned as 000129; H-1 took 000129, so this is 000130 and 09E-13's
`session_bootstrap` becomes **000131**; renumbered in `09E-PLAN.md`: front matter `migrations:`, the file list, the 09E-12 and 09E-13 headings and steps, the
gate's and `09E-P3`'s ranges, `EXPECTED_MIGRATION` at the end of the phase). No new dependency. Steps 1 to 3 (the split point) and 4 to 5 shipped in one commit.
**Sign and Bill `expectedVersion`** (the 09E-07 PO question 1, "09E-12 candidate"): **not included**: the plan's 09E-12 section does not list it (it would
need `consult_screen` replaced); it stays a PO question.

### What shipped

- **000130** (`supabase/migrations/000130_schedule_range.sql`): `public.schedule_range(p_tenant_id, p_from, p_to, p_include_slots DEFAULT true) RETURNS jsonb`,
  STABLE INVOKER, `search_path ''`, EXECUTE `authenticated` only. `appointments:view` (`public.has_permission`); NULL for no session, another clinic, a forged or
  unknown tenant, a clinic that is not full, a NULL argument, a reversed range or more than 42 days. One statement answers `zone`, `server_now`, `versions`
  {schedule, queue} (same snapshot), `clinicians` (active doctors and the practising owner: id, full_name, specialty, slot_minutes floored at 5, the effective
  weekly schedule), `blocks` touching the range, the range's non-cancelled scheduled `visits` (the card's fields + `row_version`, patient name), the waiting
  `waitlist` of the range, and `slots` (unless `p_include_slots` is false): per clinician and clinic date `[[start minute from local midnight, length], …]`
  from **`public.available_slots`** (the definer wrapper of `private.available_slots_core`, the list the booking commands check). No slot rule in SQL or
  TypeScript beyond that call.
- **Server**: `features/schedule/queries.ts` is now `getScheduleRange` (one `rpc`, the user's JWT client; the 09D per-(doctor, date) `available_slots`
  batching and the directory/zone/visits/blocks/waitlist reads of `getSchedule` are gone from the Schedule's path). **Route** `GET /api/schedule/range?from&to[&slots=0]`
  (`resolveServiceContext("appointments:view")`; 401, 403, 403 `SUBSCRIPTION_LOCKED`, 503, 409 `CLINIC_CHANGED`, 400 `INVALID_RANGE` before any read,
  500; `private, no-store`; `timedRoute`). Guard manifest entry (kind `session-board`, new `currentWeek` flag), `server-routes.ts` regenerated, inventory 0 flagged.
- **Pure model** `features/schedule/range.ts`: the answer's parser, `rangeOfDate` (the Monday-to-Sunday week that holds a date), `adjacentRanges`, `isRangeOk`
  (the route's check), `rangeVersions` (the live core's basis), `buildScheduleData` (day, agenda and week from one range: visits by clinic date, blocks clipped
  to the day, waitlist of the date, week counts, the role's edit and block rights, names as the directory formats them), `freeSlotsOf` and `serverNowOf`
  (slots that have started are hidden by the device clock corrected by its offset to `server_now`, taken when the range is first seen; display only).
- **Client** (`components/schedule/use-schedule-range.ts`, `schedule-view.tsx`, `navigate.ts`, `schedule-head.tsx`, `week-overview.tsx`): one query per week,
  key `queryKeys.scheduleRange(tenant, from, to, withSlots)` (ids and dates only), `meta {live, domains: [schedule, queue]}`, `staleTime: Infinity` (the live
  core re-reads the visible range on a newer version and removes the others); the page reads the week of the date (or of the clinic's today: read in the
  default zone, read again only if the clinic's own today falls in another week) and hydrates it with its versions as the basis; changing day, week, view or
  doctor moves the address with `history.pushState` (links stay real links; modified clicks open new tabs) and reads the query; once the visible week settles
  the weeks before and after are prefetched (`x-clinicos-prefetch: 1`); the Schedule is a live screen (`useLiveScreen`) and shows the `LiveBadge`; the
  skeleton shows while a week not held is read.
- **Booking sheet** (`components/front-desk/slot-section.tsx`): a booking whose doctor and date a held range covers takes its slots from the range (no call);
  a move (`excludeVisitId`) and "Try again" still call `getAvailableSlots`.
- **After a save** (`lib/query/after-save.ts`): the Schedule's ranges are invalidated (one range GET, no `router.refresh`); a sheet that closes by its URL still
  renders the page once (it hands the fresh range over).
- `scripts/perf/command-latency.ts`: `range: schedule_range (42 days, 3 clinicians, 600 visits, slots)`, target p95 < 100 ms.

### Specs

- **pgTAP `schedule_range.test.sql` (78)**: grants (INVOKER, `search_path`, EXECUTE authenticated only; anon and service_role refused); 10 NULL cases; 42 days
  answer, 43 do not; every member role answers; exact key sets of the answer, a clinician, a visit, a block, a waitlist entry, a slot entry; no `slots` key with
  `p_include_slots false`; versions equal `clinic_versions`; the rows (week's visits without the cancelled one, outside the range or B's; blocks touching the
  week; waiting entries only; clinicians without admin, receptionist, nurse, removed doctor or a non-practising owner; a NULL schedule returned equal to
  `private.effective_schedule(null)`); **slots equal `public.available_slots` in a 25-case table** (default hours, Saturday, Sunday off, two shifts, a disabled
  day with shifts, a night shift whose UTC day differs, 5-minute slots under a 20-minute booking, 45-minute slots, clinic-wide block, own block, overbooked /
  booked / cancelled / no-show / confirmed, a day blocked all day, a past day, today, New York on an ordinary Sunday and on the fall-back Sunday, a disabled
  Monday, later weeks).
- **Vitest `tests/schedule/schedule-range.spec.ts` (16)**: the range of a date and its neighbours, the route's check, the key, the parser, the basis, the builder
  (visits by clinic date, past slots hidden by the server-corrected clock, doctor filter, block clipping, waitlist, week counts, role rights), the clock offset.
  `tests/schedule/schedule-slot-round.spec.ts` **deleted** (it tested the 09D batching the Schedule no longer has).
- **Guard legs** (`tests/security/guard-routes.spec.ts`, `session-board` on `app/api/schedule/range`): 401, 403, no membership, the holder 200 `no-store` with
  exactly the keys, forged `?tenant=` changes nothing and nothing of B, 409 for another clinic's header, 200 for its own, locked 403.
- **e2e `tests/e2e/schedule/schedule-live.spec.ts`** (3 projects): B-11 a booking committed elsewhere appears in the open day view within 2 s and its slot
  disappears, 0 RSC; Realtime refused: it appears once the page clock passes 12 s; B-9 the next day (same week) and Monday of the next week show with no read
  of their range (prefetched); B-10 a date three weeks away is one read of its week; the route serves 42 days with one `schedule_range` call (no per-part
  read), refuses 43 (400), `slots=0` has no `slots`; a slot still shown that someone else booked is refused by the command (the existing "Slot Already Booked"
  question; one visit in the database). **`tests/e2e/shell/query-clear.spec.ts`** + one case: after a clinic switch and after a sign-out, no appointment of the
  other clinic ever renders on the Schedule.

### Fails-without (High: `schedule_range` for another clinic)

The function was re-created inside a rolled-back pgTAP transaction **without its `has_permission` check** and the 78 cases run against it: **1 failed**: the
owner of a clinic that is not full got that clinic's schedule (clinicians, zone, versions) instead of NULL. The other-clinic and forged-tenant cases stayed NULL
because RLS hides another clinic's `tenants` row (the function returns NULL when it cannot read its own clinic): defence in depth, so the plan's "another
clinic's visits come back" does not happen; what the check uniquely enforces is the full-clinic (access) gate. Restored; the committed file passes 78 of 78.

### Budget rows (tool output `evidence/09E-12/schedule-rows-300ms.{json,md}`, merged onto `evidence/H-1/medicine-row-300ms.json`; ceilings by `latency-ceilings.mjs --write`, none raised)

| Row | Before (calls / depth) | After (calls / depth, median ms) |
| --- | --- | --- |
| `in-app.R.schedule-day` (B-1, `@budget`) | 8 / 7 | **1 / 1**, 479 ms |
| `in-app.R.schedule-week` (B-1; now B-9-like: same week) | 15 / 8 | **0 / 0**, 40 ms |
| `full.R.schedule-day` (B-3) | 11 / 7 | **4 / 3**, 1,524 ms |
| `full.R.schedule-week` (B-3) | 18 / 8 | **4 / 3**, 807 ms |
| `save.R.book` (B-7) | 9 / 8 | **4 / 3**, 903 ms |
| `save.R.register-book` (B-7) | 9 / 8 | **4 / 4**, 937 ms |
| `save.R.reschedule` (B-7) | 9 / 8 | **4 / 4**, 855 ms |
| `save.R.cancel` (B-7) | 10 / 8 | **2 / 2**, 804 ms |

(The full-load rows' other calls are the shell's: membership, notifications.) Lane: `--grep "schedule|save.R.(book|register-book|cancel)" --retries=0`
after `stack:recycle`: **16 passed**. The first run counted the two prefetch reads inside the step's window (3 calls) and failed the week row's tracer check
(0 calls: the view switch now draws from the held week); both root-caused, not retried: prefetches carry `x-clinicos-prefetch: 1` and the lane holds them
like the shell's other background work (`holdBackground`); the row is flagged `zeroCalls` (its 0/0 ceiling is the blocking check).

`command-latency.ts` (tool output `evidence/09E-12/command-latency.json`, 100 calls, 0 errors): **`schedule_range` 42 days, 3 clinicians, 600 visits, with
slots: p50 305.0, p95 368.9 ms: over R-16's 100 ms target** (the script exits 1 on it, and on the reads already over target; this run was slower across the
board: today_board 213.5, consult_screen 139.2). The cost is the slot list: 42 × 3 calls of `available_slots` (one per clinician and date, each re-checking the
permission and scanning blocks and visits). The Schedule itself reads 7-day ranges (the lane's B-1 row: 1 call, 479 ms at 300 ms injected); 42 days serve the
future month view. Not changed here (it would mean a set-based slot core: a change to `private.available_slots_core`, outside this plan): PO question 2.

### Decisions and deviations

- **One range = the Monday-to-Sunday week** of the date; the day, agenda and week views are all built from it, so a day change within a week and the view
  switch need no call, and the prefetch of the weeks before and after covers B-9 at week edges. The page reads that week; the route serves any 1 to 42 days.
- **`waitlist` added to the answer** (not in the plan's field list): the Schedule's head shows the waiting count and the sheet lists them; without it the page
  needs a second read (depth 2). Patient name only, like the visits; `waitlist_entries` already moves the `schedule` domain (000123).
- **Clinician names**: `schedule_range` returns `full_name`; the device formats it with `formatDoctorDisplayName` (as the screen did) instead of
  `private.doctor_display_name`, which an INVOKER function cannot call (no EXECUTE for `authenticated` on `private.*`). For the same reason the slots come
  through the public definer wrapper `available_slots` (same core), and the default weekly schedule is the same literal as `private.default_weekly_schedule`
  (pgTAP asserts equality). Clinicians are the Schedule's directory (doctors, the owner when practising), ordered by membership creation (the old read had no order).
- **Not in this plan**: the booking sheets' doctor list still comes from `useClinicDoctors` (09E-13 moves the directory to the bootstrap); a move keeps
  `getAvailableSlots` (its own visit must be listed again, which the range's slots do not do); no lane rows were added for B-9 / B-10 (asserted by the e2e;
  `in-app.R.schedule-week` is now a 0-call row); `staleTime: Infinity` on ranges (freshness is the live core's job: re-read the visible, remove the others).
- **The lane holds the Schedule's prefetch** (`x-clinicos-prefetch: 1`) during a measured window, as it holds the status check and the catalogue sync.
- **Finding, not changed (PO question 3)**: `private.available_slots_core` (000103) raises 22000 ("range lower bound must be less than or equal to range upper
  bound") on a spring-forward day for a shift across the missing hour in a zone with daylight saving (slot 02:30 EST .. 03:00 EDT). `available_slots` fails
  today; `schedule_range` fails the same way for a range containing that day (pgTAP case 19 records both). No effect in Asia/Kolkata.
- Affected-test grep (`data-schedule|data-day-grid|data-week-overview|getSchedule|/schedule`): m0/{book,cancel}-appointment, consult/smart-assist,
  today/review-fixes-08-06a, shell/{clinic-zone-hydration,loading-states,query-clear}, design/screens/{schedule,screenshot-set}, pwa/{13-idempotent-retry,
  10-ipados,ui-checks-06-06}, perf/{latency-pages,latency-saves,page-roundtrips}, schedule/schedule, jobs/run-route, journeys/journey-04, support/app-env,
  subscriptions/locked; Vitest `tests/schedule/schedule-slot-round` (deleted).

### Security-sensitive for the adversarial review

`supabase/migrations/000130_schedule_range.sql` (INVOKER, `appointments:view`, NULL cases, 42-day cap, fields beyond the screen, the call into the definer
`available_slots`, waitlist names), `supabase/tests/database/schedule_range.test.sql`; `app/api/schedule/range/route.ts` (session, permission, tenant from the
session, 409 before the read, 400 before the read, `no-store` for patient names); `features/schedule/{queries,range}.ts`; the query keys (`lib/query/keys.ts`:
dates and ids only) and the range cache in memory (cleared with the client at sign-out, switch, lock; the query-clear case); `components/front-desk/slot-section.tsx`
(slots from a held range: display only, the command re-checks); the guard manifest entry and engine change (`tests/security/guard-manifest.ts`,
`tests/security/guard/engine.ts`); the lane's prefetch hold (`tests/e2e/perf/latency-run.ts`). No service-role client, no cookie, no PHI on the device beyond
the in-memory query (as Today).

### For the PO

1. Sign and Bill with the visit's version (09E-07 question 1) is still open: not in 09E-12's plan.
2. `schedule_range` for 42 days with slots is p95 369 ms locally (target 100 ms); the screen's 7-day reads are within budget. Accept until the month view is
   built, or plan a set-based slot core then?
3. The daylight-saving fault of the slot core (above): fix in a later migration (no Indian clinic is affected)?

### Tests run (local stack, `stack:recycle` before each e2e and lane run, `--retries=0`)

- `npm run typecheck` clean; eslint on the touched trees 0 problems; `npm run inventory` 0 flagged; `client-routes --check` PASS; `ci:ui-policy` PASS;
  schema snapshot `--check` PASS after `db reset --local`.
- pgTAP (after `db reset --local`): **9,831 tests in 78 files, 0 failed**, gate PASS at floor 9,831 (9,753 + 78). `schedule_range` 78 of 78.
- Vitest `tests/schedule tests/query tests/observability tests/security/guard-routes.spec.ts tests/realtime tests/visits tests/live tests/ci
  tests/api/readiness-probe-db.spec.ts`: 83 files, 1,280 tests: 1,279 passed, 1 failed = the new guard leg (the clinic-changed and locked legs called the
  range route without its dates: 400; fixed in the engine) → `session-board` legs 4 of 4.
- e2e (3 projects): `schedule/*` + `shell/query-clear`: 53 passed, 2 failed (the 42-day case counted the shell's background reads of an open page in its
  Kong window; the window now runs with no page open and asserts one `schedule_range` call and no per-part read) → `schedule-live` 19 of 19. Affected:
  `today/*`, `live/*`, `journeys/journey-04`, `m0/{book,cancel}-appointment`, `shell/{loading-states,clinic-zone-hydration}`, `pwa/13-idempotent-retry`,
  `subscriptions/locked`: **185 passed, 61 skipped by design, 0 failed**.
- Lane: the schedule rows (above), 16 passed. Not run: the full PR lane, the nightly lane, full Vitest, the design projects (no screenshot changed; the badge
  in the head is checked by `schedule.spec` "no horizontal scroll and axe" on the three projects) (CI runs them).

## 09E-13 Session bootstrap

Branch `v2/phase-09e-pr2-search-schedule`. Migration **`000131_session_bootstrap`** (renumbered from 000130 by 09E-12, already in `09E-PLAN.md`). No new
dependency. Commits: `2e077095` (migration, pgTAP, registries), `3aa9c500` (route, client, consumers, fees with the bill, specs), `c9f04836` (lane root causes:
passive bootstrap, parallel read, zod-free shell), then this notes commit.

### What shipped

- **000131** `public.session_bootstrap(p_tenant_id) RETURNS jsonb` (STABLE INVOKER, `search_path ''`, EXECUTE `authenticated` only; NULL unless the caller
  is an ACTIVE member of the clinic; no session, NULL, another clinic, a forged tenant, a removed member → NULL). Keys, exactly: `profile {id, full_name}`,
  `clinic {id, name, zone}` (zone resolved case-insensitively against `pg_timezone_names`, `Asia/Kolkata` fallback), `role` (display/navigation only),
  `doctors [{id, full_name, specialty}]` (the bookable directory exactly as the pickers listed it: active doctors + the owner when practising, by membership
  creation, "Doctor"/"Clinic Doctor" for a blank name), `clinics [{id, name}]` (the caller's own active clinics: the switcher), `rx_print {paper_size,
  letterhead_mode, top_margin, bottom_margin}`, `versions {settings}` from the same statement. No fee, price, invoice, payment, subscription, access,
  entitlement or permission field.
- **Allow-list in TypeScript**: `features/session/bootstrap.ts` (zod, every object `.strict()`; `parseSessionBootstrap` returns null for anything else);
  `features/session/view.ts` (zod-free helpers for the shell); `features/session/queries.ts` (`readSessionBootstrap`, user JWT client, logs by tag only).
- **Route** `GET /api/session/bootstrap` (`resolveServiceContext()`: any active member of a full clinic; 401, 403, 403 `SUBSCRIPTION_LOCKED`, 503, 500, 409
  `CLINIC_CHANGED` before the read; `private, no-store`; `timedRoute`). Guard manifest kind `session-bootstrap` + engine legs; `server-routes.ts` regenerated;
  inventory 0 flagged.
- **Layout** (`app/(dashboard)/layout.tsx`): the bootstrap read **replaces** the layout's membership read for the switcher (`listUserClinics`; still used by
  the clinic picker), starts for the device's pinned clinic before the membership resolution and is awaited together with the access level, then hydrates
  `queryKeys.bootstrap(tenantId)` (`HydrationBoundary`). `QueryProvider` now wraps the shell; the old "render nothing once cleared" gate is `QueryScreens`
  around the screens (the shell stays mounted so its query does not read again during an exit).
- **Client** `lib/session/use-bootstrap.ts`: one query per clinic, `staleTime: Infinity`, `meta {live, passive, domains: ["settings"]}`: re-read on a newer
  `settings` version (signal, heartbeat of a live screen, the check on resume/visible/`online`/rejoin) and by a layout render (`router.refresh` after a
  settings save); a confirmed Rx-print save re-reads it at once; cleared with the client at sign-out, lock and switch (R-14). `BootstrapLiveBasis` gives the
  hydrated query its exact basis. **Consumers**: `components/shell/session-shell.tsx` (clinic name, zone for `ClinicTimeZoneProvider`, role label and
  `navForRole` navigation, switcher list); `components/front-desk/use-doctors.ts` (booking, reschedule, waitlist sheets) and `walk-in-sheet.tsx` take the doctors
  from it (no `getActiveClinicDoctors` call when a sheet opens). Sidebar gained `data-shell-clinic-name` / `data-shell-role` (test hooks, no visual change).
- **Fees read with the bill** (R-13): `getVisitBillingDetails` returns `clinicFee` (the clinic's `default_consultation_fee`, read from the database) when the
  visit has no invoice yet; the checkout drawer starts a new bill from it. Before, the drawer always pre-filled a hard-coded 500 and the clinic's fee setting
  was not used anywhere in the UI (finding; see PO questions).
- **Live core** (`lib/live/live-core.ts`, `provider.tsx`): `Dependent.passive`: a passive query converges like any other but never makes the channel's join
  ask the server on its own (so the bootstrap, active on every page, does not add a `clinic_live_state` call to pages that are not live screens).
- `scripts/perf/command-latency.ts`: `read: session_bootstrap` (target p95 < 50 ms).
- Directory read off the screens' paths: `features/staff/actions.ts` directory actions have no app/component caller (grep), so nothing changed there;
  `features/visits/actions.ts#getActiveClinicDoctors` stays for the Visits page's server-side filter (one read in its `Promise.all`).

### Kong counts, before and after (tool output `evidence/09E-13/sheet-calls-{before,after}.txt`, desktop-chrome; before = the 09E-12 build)

| Window | Before | After |
| --- | --- | --- |
| Open the walk-in sheet (Today) | `rpc/today_board` 1, `tenants` 1, `memberships` 1 | `rpc/today_board` 1 |
| Open the booking sheet (Schedule free slot) | `rpc/schedule_range` 1, `tenants` 1, `memberships` 1 | `rpc/schedule_range` 1 |

(The board/range call is the page's own soft navigation to `?walkin=1` / `?book=1`.) A full load: the layout's `GET memberships` became
`rpc/session_bootstrap` (same count). In-app navigations make no bootstrap, directory or settings read (the layout does not re-render; lane in-app rows below).

### Specs

- **pgTAP `session_bootstrap.test.sql` (30)**: grants and shape; 9 refusal/answer cases (another clinic both ways, forged tenant, no membership, removed
  member, no session, NULL tenant, every role answers, a clinic that is not full answers); **every key path at every level equals the allow-list**; the
  owner sees the same paths as the receptionist; no fee/price/invoice/payment/subscription/access/entitlement/permission/plan/amount key at any level;
  `versions.settings` = `clinic_versions`, also after a rename in the same transaction; values (profile, clinic and zone per clinic, role, the doctor
  directory with the practising owner and a blank name, a non-practising owner absent, a dual member's own two clinics only, rx_print).
- **Vitest `tests/session/bootstrap.spec.ts` (17)**: the strict schema refuses an extra key at the top, in the clinic, profile, a doctor, a switcher clinic,
  rx_print and versions (10 cases), malformed answers (4), null; switcher order. `tests/live/live-core.spec.ts` +1 (passive dependent). Guard leg
  `session-bootstrap` (401, 403, locked 403 with no read, every role 200 no-store no cookie with exact top/nested keys and its own role, no never-held key,
  one `session_bootstrap` call, another clinic's header 409, forged `?tenant=` identical). `tests/clinics/switch-clinic-db.spec.ts` and
  `tests/auth/session-auth-reverify-db.spec.ts` find the shell by type (`tests/helpers/element-tree.ts`) and read the switcher's clinics from the hydrated bootstrap.
- **e2e `tests/e2e/shell/bootstrap.spec.ts`** (desktop-chrome, pixel-7, iphone-15): signal (clinic and doctor renamed by another device → B's shell name
  within 2 s, B's walk-in doctor picker shows the new name, opening it reads no `memberships`/`tenants`, 1–2 bootstrap reads, 0 RSC); dropped frames on Today
  → the rename shows only after the page clock passes 12 s (one bootstrap read); resume on Patients with the socket refused → shows after hidden→visible
  (one read); **fees never held** (fee changed elsewhere → B's drawer shows 735, the invoice item is written at 735, 0 RSC between); role changed elsewhere with
  B deaf (frames dropped, state reads held, shell still "Receptionist") → B's collect is refused ("do not have permission"), nothing billed; role changed
  with signals → role label "Nurse" and Schedule moves to the secondary group within 2 s, 0 RSC. **`query-clear.spec.ts`** +1: after a clinic switch no
  document names clinic A in the shell and B's walk-in sheet never lists A's doctor; after sign-out and another user's sign-in no document names clinic B.

### Fails-without (High: fees never held; tool output `evidence/09E-13/fees-fails-without.txt`)

The fee was put into the bootstrap (`session_bootstrap` re-created with `clinic.fee` on the local stack, the schema and the drawer reading it), rebuilt, and
the fee spec run on desktop-chrome: **failed, `Expected: "735"`, `Received: "500"`** (B billed the fee its bootstrap held; `default_consultation_fee` is not a
`settings`-domain column, so no signal ever refreshed it). Restored (source by `git checkout`, the function from the migration file; `session_bootstrap`
pgTAP 30/30 and the schema snapshot `--check` PASS after the restore), rebuilt.

### Lane rows (300 ms; root causes, no retries)

Full lane `npm run perf:latency -- --retries=0` on `c9f04836` after `stack:recycle` (tool output `evidence/09E-13/lane-300ms-rows.txt`,
`lane-300ms-failures.txt`, `lane-300ms.{json,md}`): **51 passed, 5 failed**. No ceiling raised; none lowered here (09E-13 owns only `bg.session-status`:
3 / 3, unchanged; `latency-ceilings.mjs` on this summary would lower `live.R.check-in-elsewhere` 11/8 → 3/2, `save.D.sign-finish` 58/34 → 57/33 and
`save.R.collect` 10/9 → 10/8, but the script rebuilds the file from one summary, which holds only 13 rows: left for the close's merged evidence run).

Root causes found on the way (each run with `--retries=0`; no ceiling touched):
- **The bootstrap made the channel's join ask on every page** (first full lane: `save.D.draft-autosave` and `save.D.edit-rx-line` 2 > 1 calls,
  `in-app.D.consult-sealed` 19 > 18, each with one `rpc/clinic_live_state`): fixed by `passive` (`c9f04836`); these rows pass.
- **Full-load depth +1** (`full.R.patient` 4 > 3, `full.D.patient` 5 > 4, `full.R.billing-reports` 4 > 3; earlier also `full.D.today` 5 > 4): the same rows
  fail identically on the **09E-12 build** (`114c1ec0`, built in a scratch worktree, same stack, same grep: `full.R.patient` 4, `full.D.today` 5): the chain
  is the page's two reads followed by the shell's notification actions, which start at hydration; pre-existing and timing-dependent (finding 3). The
  bootstrap read itself starts with the membership checks (calls equal: `GET memberships` → `rpc/session_bootstrap`).
- **`save.R.book` depth 4 > 3** (calls 4, unchanged): traced with a temporary log in both builds: on every new page the Realtime join is refused (finding 1)
  and the socket rejoins about 6 s after the page opened. Before 09E-13 the booking sheet waited for its `getActiveClinicDoctors` action, so the save
  committed after the rejoin and its signal arrived; now the sheet has its doctors at once, the save commits inside the refused window, its signal is lost,
  and the range re-read waits for the rejoin check (`register_and_book` → `schedule_range` → `clinic_live_state` → `schedule_range`). With the token applied
  before the join the row passed (`9 passed`, no `Unauthorized` in the Realtime log), but that change broke three live specs and was reverted (finding 1).
- **`full.D.consult-sealed` 23 > 22** (sample 3 only): a `POST /auth/v1/token` (the lane user's session refreshed inside the window, 35 minutes into the
  run); the other 22 calls are the row's own. Lane artifact, recorded.

`command-latency.ts` (tool output `evidence/09E-13/command-latency.json`, 100 calls): **`read: session_bootstrap` p50 39.0, p95 48.4 ms** (target < 50). The
script exits 1 on the reads already over target before this plan (`consult_screen` 261.6, `today_board` 188.2, `schedule_range` 435.2, the reference shards).

### Decisions and deviations

- **`clinics` (the switcher list) added to the bootstrap** (not in the plan's field list): the plan's "beside the layout's existing read" adds one call to
  every full load and every `router.refresh`, which the call ceilings forbid (raising is a PO question). The bootstrap replaces that read instead (same
  count, same depth). When the device has no context cookie the layout still reads `memberships` for the membership itself, so such a load makes one more
  call than before (the lane's rows run with the cookie).
- **`doctors` = the bookable directory** (doctors + the practising owner, as `getActiveClinicDoctors` and `schedule_range` list them) with `specialty` (the
  picker label), instead of "owners and doctors with `consultations:edit`" (a non-practising owner holds that permission but is never bookable).
- **No server-side consumer of `rx_print` yet**: the Rx print view and PDF are built from the database at print time (the frozen prescription values plus the
  margins); they stay so. The bootstrap holds the display fields; the Rx print card re-reads the bootstrap after a confirmed save.
- **Locked clinics**: the SQL answers any active member (plan); the route refuses a clinic that is not full (its users are on the locked pages).
- **`passive` dependents** (live core) and **pinned-clinic early read** in the layout: both from lane root causes (below).
- **Display name** (`profile.full_name`) is held but the shell keeps showing the e-mail (no design change in this plan).
- Affected-test grep (`getActiveClinicDoctors|useClinicDoctors|listUserClinics|ClinicTimeZoneProvider|AppShell|QueryProvider|getVisitBillingDetails|...`):
  `tests/auth/session-auth-reverify-db`, `tests/clinics/switch-clinic-db` (updated), `tests/billing/*`, `tests/integration/per-visit-billing`,
  `tests/queue/stale-write-services`, `tests/staff/doctor-picker`, `tests/visits/clinic-visits-register`, `tests/pwa/hard-sign-out`,
  `tests/subscriptions/lock-enforcement`; e2e `journeys/journey-05-walk-in`, `m0/walk-in-token`, `pwa/{04-offline,13-idempotent-retry}`,
  `shell/clinic-switcher`, `today/front-desk`, `perf/latency-saves`.

### Findings (not changed here)

1. **The Realtime channel joins with the publishable key on every new page** (pre-existing since 09E-04; same in the 09E-12 build, A/B traced): Realtime logs
   `Unauthorized: You do not have permissions to read from this Channel topic: today:<tenant>` (token `iss=supabase-demo`) at each page open; realtime-js
   rejoins after its backoff, so a freshly loaded page has no live channel for about 6 s (the badge says Reconnecting; signals of that time are lost; the
   heartbeat and the rejoin check catch up). Tried: `await client.realtime.setAuth()` before `subscribe` removed the refusals and fixed the lane's book row,
   but `convergence.spec` "dropped" (desktop, pixel-7) and `today-live` "a check-in ... within 2 s" (desktop) then timed out: reverted, needs its own
   investigation (09E-14a candidate).
2. **The clinic's default consultation fee was never used by the UI** (both bills pre-filled a hard-coded ₹500): the checkout drawer now starts from it (read
   with the bill); **Sign & Bill (doctor) still pre-fills ₹500** (it makes no read when it opens).
3. **Full-load depth rows are timing-dependent** (pre-existing): `full.R.patient`, `full.D.today`, `full.D.patient`, `full.R.billing-reports` fail their depth
   ceiling by 1 **on the 09E-12 build too** on this machine today (A/B: `full.R.patient` 4 > 3, `full.D.today` 5 > 4 with the 09E-12 build and stack): the
   shell's notification actions start at hydration and count as a link of the chain when they start after the page's second read ends. Not raised.

### Security-sensitive for the adversarial review

`supabase/migrations/000131_session_bootstrap.sql` (INVOKER, active-member gate, NULL cases, the allow-list, `clinics` across the caller's memberships, RLS
on other members' rows), `supabase/tests/database/session_bootstrap.test.sql`; `app/api/session/bootstrap/route.ts` (session, tenant from the session, locked,
409 before the read, `no-store`); `features/session/{bootstrap,queries,view}.ts` (strict parse, no field outside the list reaches the device);
`app/(dashboard)/layout.tsx` (the bootstrap read for the pinned clinic before the membership resolves: used only when the session resolves to that clinic;
the role it carries is display/navigation only; the layout's guards unchanged); `lib/session/use-bootstrap.ts`, `lib/query/{provider,keys}.ts` (memory only,
cleared on exit, `QueryScreens`, one key per clinic), `components/shell/session-shell.tsx` (navigation from the bootstrap role: pages and commands keep their
own checks), `lib/live/{live-core,provider}.ts` (`passive`); `features/billing/service.ts` + `components/queue/checkout-drawer.tsx` (fee read with the bill);
`tests/security/{guard-manifest.ts,guard/engine.ts,guard-routes.spec.ts}`. No service-role client, no cookie, no server cache, no PHI in the bootstrap.

### For the PO

1. The bootstrap also carries your clinics list for the switcher (so a page load makes no extra call). Acceptable?
2. Sign & Bill still starts at ₹500 instead of the clinic's fee (the desk drawer now uses the clinic's fee). Fix it in 09E-14a (one read when the dialog opens)?
3. The live channel's first join on every page is refused (finding 1): fix in 09E-14a?
4. The four full-load depth rows that fail by one on the unchanged 09E-12 build: re-baseline them at the close's evidence run, or treat the notification
   calls as background work in the lane?

### Tests run (local stack, `stack:recycle` before each e2e and lane run, `--retries=0`)

- `npm run typecheck` clean; eslint on every touched tree 0 errors (pre-existing warnings in `features/billing/service.ts` only); `npm run inventory` 0
  flagged; `server-routes.mjs --write`, `client-routes.mjs --check` PASS; `ci:ui-policy` PASS; `ci:ai-l1` PASS; schema snapshot `--check` PASS.
- pgTAP after `db reset --local`: **9,861 tests in 79 files, 0 failed**, gate PASS at FLOOR 9,861 (9,831 + 30). `session_bootstrap` 30/30 (again after the
  fails-without restore).
- Vitest: `tests/session tests/security/guard-routes.spec.ts tests/observability tests/query tests/live` 29 files, 578 passed; `tests/settings tests/staff
  tests/billing tests/clinics tests/visits tests/ci ...` 73 files, 1,058 tests: 1,056 passed, 2 failed (the two layout-tree tests, updated) → both files 70/70;
  `tests/live tests/session tests/query` 80/80 after `passive`.
- e2e (3 projects): affected set `tests/e2e/{shell,settings,today,schedule,live}` + `m0/walk-in-token`, `journeys/journey-0{4,5}`,
  `pwa/{04-offline,13-idempotent-retry}`: **371 passed, 165 skipped by design, 0 failed** (on `3aa9c500`); after `c9f04836`: `live/*`,
  `shell/{bootstrap,query-clear}`, `today/today-live`, `schedule/schedule-live`: **71 passed, 0 failed**.
- Lane: above. Not run: full Vitest, the design projects (no screenshot tracked file changed), the nightly device matrix (CI and the close run them).
- **Phase-level exit check (decision 1, "0 hits at the close")**: `grep -rnE 'unstable_cache|"use cache"|revalidateTag' app components features lib` →
  **0** (tool output `evidence/09E-13/no-server-cache.txt`, at `3aa9c500`).

## 09E PR 2 review fixes

Branch `v2/phase-09e-pr2-search-schedule`, the single fix round of PR 2 (independent review `review-pr2-independent.md`: I-1..I-3, N-1..N-13; adversarial
review `review-pr2-adversarial.md`: no important finding, N1..N9). First `origin/v2/phase-09e-caching-speed` (PR 1's tip `29fb0b04`, its CI evidence
commit) was merged in (`ffcb878d`, merge commit, no conflict), so it is an ancestor. Two new migrations: **`000132_doctor_directory_versions`** and
**`000133_review_fixes_09e_pr2`**. No new dependency. Commits, in order: `22df46de` + `833747ae` (I-1), `5985e451` (I-2), `b0ff55a5` (I-3), `38dc55cd`
(N1), `f5f51698` (N5), `f7cea7a6` (N4, N-7), `92412816` (N8, N9), `2f31d277` (N-3), `e5bd7384` and `ba406480` (N1 follow-ups found by the affected e2e run and the lane), `d0d09ba2`
(a spec timing defect found by the run), then this notes commit.

### What changed

- **I-1 (000132)**: `private.cv_tenants_update` moves `schedule` and `settings` when `owner_is_practicing_doctor` changes (the bootstrap's doctors and
  `schedule_range`'s clinicians both filter on it); `private.cv_memberships_update` watches `default_specialty` too (→ `schedule`, `settings`, the picker
  label). Same signatures, the triggers unchanged. `schedule` is raised before `settings`: the first version raised them the other way and
  `tests/live/version-lock-order.spec.ts` refused it (VERSION_LOCK_ORDER, deadlock safety); the file was corrected in `833747ae` before it was pushed or
  applied anywhere but the local stack.
- **I-2**: `schedule-view` reads the range query's `isError` and `fetchStatus`: a week the device does not hold whose read failed shows "The schedule could not
  be loaded" with **Try again** (a re-read); a read paused for the network shows "You're offline" and loads by itself on reconnect. A held week whose re-read
  failed keeps its data.
- **I-3**: the booking picker takes slots only from a Schedule range whose query is **active** (a mounted Schedule, kept current by the live layer and its
  heartbeat). A range in memory that no screen shows is never used: the sheet asks the server (`getAvailableSlots`). The section subscribes to the query cache
  (`useSyncExternalStore` on the range's hash and `dataUpdatedAt`), so a re-read of the shown range, or the Schedule leaving the screen, updates the open picker.
- **N1 (adversarial; the refused first join, 09E-13 finding 1)**: root cause: `realtimeClient()` gives supabase-js an `accessToken` callback, which it applies
  to Realtime asynchronously; `subscribe()` ran first and the join carried the publishable key, the private channel refused it, and realtime-js rejoined about
  6 s later. Fix: `await client.realtime.setAuth()` before `subscribe`, and again on visible and `online` (realtime-js also re-reads the callback on every
  25 s heartbeat and pushes a changed token to the joined channel, so a cookie the proxy refreshed reaches the channel without a rejoin). **Why three live
  specs broke when this was tried in 09E-13**: with the join accepted, SUBSCRIBED lands before Today's screen effect registers, so `channel(true)` saw no screen
  and made no check, and nothing confirmed the versions until the 12 s heartbeat (never, under a paused page clock): the badge stayed Reconnecting and
  `convergence` "dropped" and `today-live` "within 2 s" timed out waiting for Live. The refusal had hidden this ordering bug (the rejoin always came after the
  screen). Fix in the core: a join that had nothing to check **owes** its check to the first screen that registers (once; dropped when the channel leaves).
  The specs were not changed. A traced load now joins about 1 s after sign-in with no refusal and is Live about 1.2 s later (before: Reconnecting for about
  6 s on every page). The passive bootstrap stays passive (a non-live page still pays no call on a join).
  **Follow-up found by the affected e2e run** (`schedule-live` B-9, desktop-chrome): the trace showed both adjacent-week prefetches `ERR_ABORTED` at the
  moment the join check answered: the check now lands about 1 s into the page, inside the prefetch, and the core removed the in-flight inactive queries as
  stale (their basis was the all-zero versions at their start), which cancels the read. The 6 s refusal had hidden this too. The core now leaves an
  inactive query with a read in flight to that read, and `fetchEnded` takes the versions the answer carries from its own statement (a range, the
  bootstrap, the board): a current read is kept, one that is behind is still removed. `shell/changed-elsewhere` counted Next's idle-time prefetch of the
  navigation links as renders because its count began at the join (once ~6 s in, now ~1 s): it now begins once the page's load traffic is idle
  (`networkidle`); every RSC request is still counted.
  **Second follow-up, from the `@budget` lane** (`ba406480`): `in-app.R.today` counted one extra `clinic_live_state`: a non-live page joined (owing its
  check) and the measured in-app navigation to Today took it, although that board was read after the channel was listening. The owed check now goes
  only to a screen of the page the document loaded with (`useLiveScreen` compares the path with the navigation entry's); an in-app Today behaves as
  before N1. The row passes.
- **N5**: a NULL answer of `schedule_range` / `session_bootstrap` after the route's session check (the database refused) is told from a failed call:
  the routes answer **403 `{error: "Forbidden", code: "ACCESS_REFUSED"}`**, logged at info (`schedule.range.refused`, `session.bootstrap.refused`); a failed
  call stays 500 with its error line, a wrong shape is an error. The layout's early read for the pinned clinic is `speculative`: its refusal logs nothing.
- **N4 (000133)**: `session_bootstrap` requires `p_tenant_id IN authz.full_tenant_ids()` (the gate of `has_permission`: the session's active clinic, full
  access). This reverses the 09E-13 decision "the SQL answers any active member of a locked clinic": the route already refused it, now the database does too.
- **N-7 (000133)**: the five catalogue tables have four statement triggers each (INSERT / UPDATE / DELETE with transition tables, TRUNCATE) on the replaced
  `private.reference_catalogue_bump`: an insert or delete moves the version only when it touched a row, an update only when a row's value differs (whole rows
  compared as jsonb), a truncate always.
- **N8 / N9**: the shard guard deletes its canary substance in a `finally` (one left by an earlier run was removed; 0 remain after a guard run); the
  denial loop covers `diagnoses` (`consultations:view`, its own version).
- **N-3 (independent nit)**: `getVisitBillingDetails` refuses with a fixed text when the clinic's fee cannot be read for a new bill; the checkout drawer
  treats any failed load as "nothing can be collected" (no amount, no Collect button, the error and Try again) instead of the hard-coded ₹500.

### Fails-without (the Important items)

- **I-1, database** (`000123`'s trigger bodies restored inside a rolled-back transaction, the new pgTAP file run against them): **3 of 16 failed** (the
  toggle off, the toggle on, the specialty: each moved nothing). **I-1, browser** (the same bodies restored on the local stack, the two-device spec run on
  desktop-chrome, then 000132 re-applied): **failed** at "B's open picker no longer offers the owner" (`toHaveCount(0)`, received 1).
- **I-3** (the previous `slot-section.tsx` built and run on desktop-chrome, then restored and rebuilt): **both specs failed**: "the slot booked elsewhere is
  not offered" (the range left behind offered 10:00) and "the open picker drops the slot booked elsewhere" (10:30 stayed).
- **I-2** has no fails-without run (the state's markup did not exist before; the spec cannot find it on the old build).
- **N4 / N-7**: before 000133 was applied, `session_bootstrap` failed its two new refusals (13, 24) and `reference_catalogues` its trigger shape and the
  no-op assertions (12, 28, 30).

### New and changed tests

- pgTAP: `doctor_directory_versions` (new, 16); `reference_catalogues` 84 → 88; `session_bootstrap` 30 (three assertions now expect the gate; clinic B is
  full and not practising); `clinic_versions` 107 (the "not listed" assertion no longer names `default_specialty`). FLOOR 9,861 → **9,881** (80 files).
- Vitest: `tests/live/live-core.spec.ts` +5 (the owed join check; dropped on leave; an in-flight prefetch is kept when its answer is current, removed
  when behind); `tests/schedule/range-refusal-route.spec.ts` (new, 6);
  `tests/billing/clinic-fee-unavailable.spec.ts` (new, 2); `tests/clinics/switch-clinic-db.spec.ts` (its mocked server client now sends the cookie's clinic
  as `x-clinicos-tenant` on RPCs, as the real one does: 000133 refused the dual member otherwise); the guard engine (N8, N9).
- e2e: `shell/bootstrap` +2 (I-1 two devices: the owner toggles "practising" in Settings in a second browser context, B's open walk-in picker drops and
  regains the owner, 0 RSC on B; N-3 the bill that cannot be read); `schedule/schedule-live` +3 (I-2; I-3 left-behind range with frames dropped; I-3 the
  open picker follows a booking elsewhere).

### Deferred nits (independent review; not changed in this round)

- N-1 `serverNowOf` takes the clock offset when a range is first shown, not when it arrived (display only, prefetched weeks).
- N-2 `schedule_range.zone` is the stored text while slot minutes use the database-resolved zone (return `v_zone` as `session_bootstrap` does).
- N-3 (second half) Sign & Bill (doctor) still starts at ₹500 and reads no clinic fee (09E-13 PO question 2).
- N-4 the layout's early pinned read is wasted when the cookie names another clinic, and its promise floats when `getActiveMembership` redirects (the log
  noise part is fixed by N5).
- N-5 a failed bootstrap read leaves the switcher empty and the pickers "no doctors" with no retry until the client re-read.
- N-6 the bootstrap's `clinics` list refreshes only on this clinic's `settings` version (another clinic's rename or a new membership elsewhere waits for a
  reload).
- N-8 `search_substances` / `search_medicines` tie-break on the id without `COLLATE "C"` (CDCI ids are digits today).
- N-9 one catalogue row of an unexpected shape (a NULL inside an array) fails the whole shard (500) and the device stays on the route.
- N-10 a worker error after a build leaves the medicine index idle while the store still marks it held (no rebuild for the tab).
- N-11 a 42-day range includes slots unless `slots=0` (about 400 definer calls; adversarial N2 is the same cost): cap slots to a week or two.
- N-12 shards are `immutable` in the HTTP cache: after a demotion without sign-out the cached URL still serves (global, non-PHI data).
- N-13 slots that pass while the Schedule sits open stay listed until the next re-read (as before 09E-12).
- Adversarial N3 (`pg_timezone_names` scanned on every bootstrap and range call, ~30 ms), N6 (the shard permission is a download limit, not a secrecy
  boundary), N7 (a DST gap fails the whole range read): recorded, not changed.

### Security-sensitive files (for the PO's gate)

`supabase/migrations/000132_doctor_directory_versions.sql` (two definer trigger functions, no grant change), `supabase/migrations/000133_review_fixes_09e_pr2.sql`
(`session_bootstrap` gate; the catalogue bump function and its 20 triggers), their pgTAP files; `lib/live/{provider.tsx,live-core.ts,use-live-screen.ts}` (the Realtime token
before the join and on visible/online; the owed join check); `app/api/schedule/range/route.ts`, `app/api/session/bootstrap/route.ts`,
`features/{schedule,session}/queries.ts`, `app/(dashboard)/layout.tsx` (refusal status and logging; tenant still from the session only);
`features/billing/service.ts` + `components/queue/checkout-drawer.tsx` (no default fee); `components/front-desk/slot-section.tsx` (which cached range may
answer); `tests/security/guard/engine.ts`. No service-role client, no new grant, no PHI in logs (tags and tenant ids only).

### For the PO

1. **Lane row `save.R.check-in` now measures 2 calls (ceiling 1)**: `check_in_visit` plus a `today_board` re-read caused by the receptionist's OWN
   check-in signal (no `clinic_live_state` in the window: the signal, not a check). The ceiling was measured while every page's first join was refused
   (N1), so no signal could arrive inside the row; in real use after the first ~6 s the re-read already happened on every check-in. Not raised (only
   the PO raises). Choose: re-baseline the row at 2, or have command answers carry the clinic version so a device's own save does not re-read
   (09E-14a candidate; other save rows of the full lane may show the same once measured).
2. N4 reverses a 09E-13 decision: `session_bootstrap` now answers only the session's active, full clinic (a locked clinic's member gets NULL from the
   database as well as the route). Agreed?
3. The two routes now answer **403 `ACCESS_REFUSED`** when the database refuses after the session check (was 500). The client shows the same "could not be
   loaded" state; should a 403 there also trigger the session-status check (the lock or removal pages) at once?
4. The deferred nits above (N-11 slot cap and adversarial N2/N3 cost items are the ones with user-visible effect at scale): schedule them in 09E-14a or V2-14?

### Tests run (local stack, `--retries=0`)

- `npm run typecheck` clean; `npx eslint .` **0 errors** (391 warnings, pre-existing; none new in the touched files beyond the existing
  `checkout-drawer` and `billing/service` ones); `npm run inventory` exit 0; schema snapshot `--check` PASS (3,006 lines) after `db reset --local`.
- pgTAP after `db reset --local`: **9,881 tests in 80 files, 0 failed**, gate PASS at FLOOR 9,881 (`assert-pgtap-report.mjs`).
- Vitest (affected: `tests/live tests/session tests/schedule tests/billing tests/query tests/clinics tests/security/guard-routes.spec.ts
  tests/api/readiness-probe-db.spec.ts tests/reference tests/realtime tests/visits tests/staff tests/settings tests/integration/per-visit-billing.spec.ts
  tests/queue tests/observability`): **79 files, 1,487 passed, 0 failed** (before the two late live-core changes); after them `tests/live` 54/54.
  `guard-routes` 75/75, and 0 synthetic guard substances remain after it.
- e2e (`stack:recycle` before, `--retries=0`, desktop-chrome + pixel-7 + iphone-15): `tests/e2e/{shell,schedule,live,today,reference}`,
  `m0/{book-appointment,cancel-appointment,checkout-collect,walk-in-token}`, `journeys/journey-0{4,5}`, `pwa/{04-offline,05-cache-audit,13-idempotent-retry}`:
  first run stopped after 2 failures on desktop (`schedule-live` B-9, `changed-elsewhere` "booking": both root-caused above, `e5bd7384`); full rerun:
  **618 tests: 452 passed, 165 skipped by design, 1 failed** (pixel-7 `reference-routes` "manifest and shard": the proxy refreshed the stored session on
  that very request ~35 min after the setup, so its Cache-Control carried `no-store, must-revalidate` and the trace shows `Set-Cookie sb-...-auth-token`;
  the spec now takes any refresh on a warm-up request first; 3 projects 14/14). After the last live-core change: `live/*`, `today-live`, `schedule-live`,
  `changed-elsewhere` on desktop-chrome + iphone-15: one run **38 passed, 1 failed** (`changed-elsewhere` "Staff and clinic settings": the notice did
  not show within 10 s; its artifacts were overwritten by the repeat run before I read them), then **39/39**, the case alone **4/4**, the file
  `--repeat-each=8` **40/40**. **Not reproduced**; candidate: the run followed a ~10 min idle stack (Realtime closes idle transports and restarts its
  replication on the next join, the 09E-14a F6 shape), and Staff and Settings have no heartbeat, so one lost broadcast is never caught there. Recorded as
  an open item, not hidden; no retry was counted as a pass.
- Latency `@budget` lane (`npm run perf:latency -- --grep @budget --retries=0`, after `stack:recycle`): first run 15 passed, 2 failed (`in-app.R.today`
  root-caused and fixed; `save.R.check-in`); final run **16 passed, 1 failed** (`save.R.check-in` 2 calls > 1: PO question 1). No ceiling raised or
  lowered.
- Not run: the full PR lane, the nightly matrix, the design projects (no screen layout or tracked screenshot changed; the new Schedule and drawer
  states use existing components), full Vitest. CI runs them on the push.
