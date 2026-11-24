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
