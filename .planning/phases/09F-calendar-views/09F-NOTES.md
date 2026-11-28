# 09F calendar views: notes

Branch `v2/phase-09f-calendar-views` off `feature/v2` @ c609907a. Plan: `09F-PLAN.md`. No migration, no new dependency, no permission, command or route
change. Executor: Claude (CTO delegation of 2026-11-28; small product decisions taken here and recorded below for the PO to review).

## Step 0: the journey 6 flake on PR 1's evidence commit (forward fix, commit 666d591e)

CI run 45663357580, `[desktop-chrome] journeys/journey-06-consult.spec.ts @golden journey 6`, attempt 1 failed, attempt 2 passed.

- **The brief's reading was not what failed.** The two `the page tried to reach non-loopback hosts` lines in that run are the **expected failures** of
  `security/network-block.spec.ts` (its self-test: "a test whose page reached for a non-loopback host fails", listed under "Expected failures (known bugs)").
  Journey 6's own network-block assertion **passed** (trace `test.trace`: `expect@426` "the page tried to reach non-loopback hosts" ended with no error).
  The guard is unchanged.
- **What failed**: `axe on the amending record` reported `document-title: html` (the top document had no title when axe scanned it), right after
  "Confirm & Reopen for Amendment", whose success calls `router.refresh()`.
- **Mechanism observed** (local probe, a MutationObserver on the document during the reopen, desktop-chrome and iphone-15, also with 8x CPU throttling):
  every `router.refresh()` re-renders Next 16's streamed metadata (`<Suspense name="Next.Metadata">` in `next/dist/lib/metadata/metadata.js`) and
  **replaces the `<title>` element** (removed, then a new one added 1 to 2 ms later). In CI the scan's `runPartial` started 200 ms after the refresh's RSC
  response; a scan that reads the document between the two leaves it without a title. Not reproduced locally in 16 runs (the swap is short), so the
  window is inferred from the observed swap and the CI timings, not caught in the act.
- **Fix (harness)**: journey 6's `expectAxeClean` leaves axe's `document-title` rule out of the scan and asserts the title on its own
  (`toHaveTitle(/\S/)`, auto-retrying) before and after it. First version (commit 666d591e) only waited for a title before the scan; the review (M-5)
  pointed out the old title satisfies that wait, so the window was narrowed, not closed. A page without a title still fails. Other specs scan after a refresh too; none has failed this way, so they were left as they are
  (forward item F-1).
- **Seen in the same log, not a failure**: the e2e server's guard logged `[e2e-net-guard] blocked non-loopback connection to ""` once while
  `/api/visits/[id]/prescription-pdf` stored the PDF (storage call `ok`, 200). A socket `connect` with an empty host from inside the storage upload path; it
  was refused and the request completed. Forward item F-2.

## What shipped

- `features/schedule/calendar.ts` (pure): `rangeOfMonth` (the six Monday-first weeks that hold the month: 42 days, exactly the range cap), `shiftMonth`,
  `buildMonthDays` (counts per clinic date for the doctor filter; missed visits left out as in the week overview; the range already leaves cancelled
  ones out; a clinic-wide all-day block marks "Closed", the filtered doctor's own all-day block "Blocked"), `buildWeekGrid` (whole-hour axis around the
  week's slots and appointments, 09:00 to 18:00 when empty; rows of the doctor's `slot_minutes`, at least 5; overlap lanes; blocks clipped to the axis).
- `features/schedule/range.ts`: `buildScheduleData` builds `week.grid` (only when the range carries slots) and `month` (when asked); its per-day part is
  now `dayParts` (same rules, shared by the day views and each grid day). `rangesFor(date, month)`: the range a view reads and what it reads ahead.
- Client: `components/schedule/week-grid.tsx`, `month-view.tsx`; `schedule-view.tsx` (week = grid from 768 px, overview list below, both in
  `[data-week-view]`; month view); `schedule-head.tsx` (Month in the view switch; previous/next move a month; "November 2026"); `use-schedule-range.ts`
  (the range and its read-ahead are passed in; `slots=0` for the month); the page reads the month without slots for `?view=month`.
- Reschedule sheet: `?reschedule=<id>&date&time` opens with that slot chosen (`front-desk-sheets.tsx`, `reschedule-sheet.tsx`); the command, its
  `expected_version` and the conflict questions are unchanged.

## DECISIONS (CTO delegation; one line of rationale each)

1. **No migration; the month reads `schedule_range` for its 42 days with `slots=0`.** The route already serves it, the 42-day cap fits six weeks exactly,
   and the counts need only visits and blocks; a counts function would duplicate the visit filter in SQL for no saving.
2. **The month shows booked counts, not free-slot counts.** Free counts need the 42-day slot list (p95 369 ms, 09E-12 PO question 2); booked counts and
   closed days answer "how busy is the month", the week and day views show free time.
3. **One doctor per week grid (the doctor filter), not doctors side by side.** Seven days times N doctors does not fit a tablet; it keeps the existing week
   rule ("one doctor is always chosen in the week view").
4. **Move by "Pick a new time on the grid" then a free slot, not drag and drop.** Drag is pointer-only (not keyboard, poor on touch) and would need its own
   confirm and conflict handling; this reuses the reschedule sheet (the slot list, overbook / off-duty / block questions, Tell the patient, `expected_version`
   read when the sheet opens, R-19), one extra tap.
5. **The week view below 768 px stays the overview list; the month works at every width.** A seven-column time grid at 360 px has 40 px columns; the
   brief's day/agenda fallback is kept and the month's seven 46 px cells are readable.
6. **Grid rows are the doctor's slot length, 44 px on touch (`pointer: coarse`) and 32 px with a mouse.** DESIGN_SYSTEM §6 asks 44 px touch targets; 32 px
   is the desktop-dense size, and every free slot stays one target.
7. **Tapping a month day opens that day with the view left to the width** (Day from 768 px, Agenda below), matching the Schedule's default.
8. **Read-ahead**: a settled week prefetches the weeks around it **and its month**; a settled month prefetches **the week of its date and the months around
   it** (all with `x-clinicos-prefetch: 1`, held by the latency lane). That is what makes week to month and back 0 calls (AC-4); the cost is one 42-day read
   without slots per Schedule visit, in the background.
9. **Grid links move in place** (`history.pushState`, as the head's links do), so opening the booking or move sheet from the grid renders no page.
10. **The month's heading is screen-reader only** (the head already shows "November 2026"); the week grid keeps the doctor's name as its heading.

## Budgets

`in-app.R.schedule-week` keeps its 0 / 0 ceiling (its data selector is now `[data-week-view]`, grid or list); `full.R.schedule-week` unchanged. Week to
month and month to week: 0 range reads, asserted by `tests/e2e/schedule/calendar.spec.ts` (no new lane row, as 09E-12 did for B-9 / B-10). No ceiling raised.

## Tests run (local stack, `stack:recycle` before each e2e and lane run, `--retries=0`)

- `npm run typecheck` clean; eslint on the touched trees 0 problems; `npm run inventory` 0 flagged; `ci:ui-policy` PASS.
- Vitest `tests/schedule`: 52 passed (new `calendar-model.spec.ts`: 12).
- e2e, 3 projects, before the fix round: `schedule/*`, journey 6, `m0/{book,cancel}-appointment`, `shell/query-clear`, `today/review-fixes-08-06a`: 97
  passed, 1 failed (`schedule.spec.ts` week case expected the overview list on desktop; updated for the grid). After the fix round: `schedule/*` + journey 6:
  **66 passed, 6 skipped (grid cases below 768 px), 0 failed**.
- Design captures (`e2e:design`, 360 / 744 / 820 / 1180 / 1280): 12 passed, PNGs in `evidence/screens/` (week, move, month).
- Lane `--project=perf-latency --grep schedule`: 12 passed (incl. `in-app.R.schedule-week` 0 / 0 and every `@budget` row), 2 failed:
  `full.R.schedule-day` and `full.R.schedule-week` at 5 calls > 4 (`clinic_live_state`, the owed join check on a document load). **Pre-existing**: the
  09E PR 2 notes ("Lane rows failing on the unchanged tree too") record the same two rows failing the same way on the unchanged tree; not `@budget`, not run
  by CI; no ceiling raised (forward item F-4).

## Review (one independent Opus reviewer; no migration or permission change, so no adversarial review)

Findings: 0 High, 5 Medium, 6 Low (`/tmp/.../09F-REVIEW.md`, summarised here). Fixed in the fix round:
- **M-1** move mode survived a doctor change, so "Move here" in doctor B's week opened the sheet for the visit's own doctor A: a move now belongs to the
  doctor's week it started in (other weeks show plain booking slots).
- **M-2** appointment blocks painted over the sticky hour axis when the grid scrolls sideways (tablet): each day column is its own stacking context.
- **M-3** lanes used real lengths while blocks are drawn at least one row tall (short visits under 30-minute rows overlapped): lanes use the drawn extent
  (unit case added).
- **M-4** read-ahead repeated after every live change: once per set of ranges (DECISION 8 updated).
- **M-5** step 0 fix narrowed the window only: `document-title` checked on its own (above).
- **L-2** slots and blocks lost 4 px to padding and the move buttons were `sm` (32 px): rows are now full height (44 px on touch), buttons default size.
- **L-5** Esc in move mode ignores a key another control already handled (`defaultPrevented`).
Not changed (backlog V2-14): **L-1** a timed (not all-day) block spanning several days is not shown on its middle days (only API / import data can create
one); **L-3** label-in-name order on the block and month cells (the names contain the visible text, after the patient / date); **L-4** the axis comes from
the week's free slots and appointments, so a past week's axis is its appointments only; **L-6** AC-5 live is asserted on the month, not the grid (the grid
re-reads the same way, B-11 covers the day view).

## Forward items

- **F-1** Other axe scans that run right after a `router.refresh()` could meet the same title swap (journey 6 was the only one seen). If another one flakes
  with `document-title`, give it the same precondition or move it into a shared axe helper (41 specs build their own `AxeBuilder` today).
- **F-2** The e2e server guard's one `connect` to an empty host during the Rx PDF upload (refused, request fine): find the caller (storage client keep-alive
  or happy-eyeballs path) in V2-14.
- **F-4** Re-baseline or remove the extra `clinic_live_state` call on the full-load rows (09E PR 2 PO question 1, still open).
- **F-5** CI run 46113640625 (this PR): `consult/rx-allergy` "an allergy recorded after a line was added" failed attempt 1 on desktop-chrome. Root cause: the
  spec reloaded while the new Rx line was still pending (optimistic, saved in the background); the reloaded page had "No medicines yet". Fixed in the
  spec (waits for the stored line, `rxStored`). Product question for V2-14: a reload or tab close during a pending Rx save loses the line silently;
  consider a `beforeunload` prompt while lines are pending.
- **F-3** Free-slot counts in the month need a set-based slot core (09E-12 PO question 2).
