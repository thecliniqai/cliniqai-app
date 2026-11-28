---
phase: 09F-calendar-views
branch: v2/phase-09f-calendar-views
base: feature/v2 @ c609907a (all of V2-09e)
migrations: none (reserved 000135-000139 left unused; see DECISIONS in 09F-NOTES.md)
new_dependencies: none
---

# 09F: calendar views (week time grid, month view)

The PO asked for a real calendar on top of the 09E-12 Schedule data layer (`public.schedule_range`, `GET /api/schedule/range`, one query per range,
prefetch, live through `clinic_versions`). This phase adds a **week time grid** and a **month view** to `/schedule`. It changes no SQL, no permission,
no command and no route.

## Goals

1. **Week time grid** (`/schedule?view=week`, 768 px and up): a time axis down the side, the seven days of the week (Monday to Sunday) across, for one
   doctor (the doctor filter chooses; one doctor is always chosen in the week view, as before). Appointments are blocks at their time and length (status
   tone, overbooked side by side), blocked time is a hatched band, free slots are targets at their time. Tapping a free slot opens the existing booking
   sheet with doctor, date and time filled in (its slots come from the held range: no call). Tapping an appointment opens its card (the existing
   `AppointmentCard`: patient, Confirm, the ⋯ menu with Move, no-show, cancel) and offers **"Pick a new time"**: the grid's free slots become "Move here"
   targets; choosing one opens the existing reschedule sheet with that date and time chosen; "Move appointment" sends the existing `reschedule_visit`
   command with the `expected_version` the sheet read (09E-07, R-19). Esc or "Stop moving" leaves the mode.
2. **Month view** (`/schedule?view=month`, every width): a Monday-first grid of the six weeks that hold the month, each day with its booked count (the
   doctor filter applies; "All doctors" allowed), "Today" and "Closed" (a clinic-wide all-day block) marks; tapping a day opens that day (Day from 768 px,
   Agenda below). Previous / next move a month.
3. **Narrow widths**: below 768 px the week view keeps the existing week overview list (counts and "Open day"); the day view's phone default stays the
   agenda. The month grid works at 360 px (7 columns, 44 px targets).
4. **Data only from `schedule_range`**: the week views read the week (7 days, with slots) as today; the month reads the 42 days of its six weeks **without
   slots** (`slots=0`, the existing route option; inside the 42-day cap). No new read, no SQL.
5. **Live**: both queries are live (`domains: schedule, queue`), so a booking made elsewhere shows in the grid and the month count without a reload.

## Out of scope

Drag and drop (pointer-only, not keyboard or touch friendly: "Pick a new time" is the explicit, accessible move); free-slot counts in the month (they need
the 42-day slot list, p95 369 ms: 09E-12 PO question 2); several doctors side by side in the week grid (the doctor filter covers it); a set-based slot core.

## Acceptance criteria

- AC-1 Week grid at desktop and tablet: blocks at the right day and time, the hour axis, free slots as links to `?book=1&doctor&date&time`; the booking
  sheet opens with that time chosen and books it (one visit in the database).
- AC-2 Move: "Pick a new time" then a free slot opens the reschedule sheet with that slot chosen; "Move appointment" moves the visit (database: new
  `scheduled_at`, `row_version` + 1); a stale screen is refused by the command (existing behaviour, `ROW_CHANGED`).
- AC-3 Month: counts per day equal the visits of the range (not cancelled, not missed) for the filter; a tap on a day opens that day.
- AC-4 Switching week to month and month to week makes **0** range calls once the other range is prefetched (B-9-like); a cold month is **1** call.
- AC-5 Live: a booking committed elsewhere shows in the open month (count +1) and in the open week grid within the live window, 0 RSC requests.
- AC-6 360 px: week falls back to the overview list, month fits with no horizontal scroll; tablet and desktop grids scroll inside their box.
- AC-7 Keyboard: every block and free slot is reachable by Tab in time order with a name ("Book Mon 30 Nov, 10:15", "Asha Rao, 10:00 to 10:15,
  Booked"); Esc leaves move mode. axe: 0 serious or critical on week grid, move mode and month at the three e2e projects.

## Latency budgets (09E lane conventions; ceilings only lowered by `latency-ceilings.mjs`, never raised)

| Row | Budget | Rule |
| --- | --- | --- |
| `in-app.R.schedule-week` (existing, B-1, `zeroCalls`) | 0 / 0 | the view switch draws from the held week: selector now `[data-week-view]` (grid or list) |
| `full.R.schedule-week` (existing, B-3) | 4 / 3 | unchanged; the month prefetch carries `x-clinicos-prefetch: 1` and is held by the lane |
| week to month, month to week (new, e2e) | 0 range calls | asserted by `schedule/calendar.spec.ts` (no new lane row, as 09E-12 did for B-9/B-10) |

## Tests

- Vitest `tests/schedule/calendar-model.spec.ts`: month range (six weeks, 42 days, inside the cap), month counts (filter, cancelled and missed left out,
  clinic-wide all-day block = closed), week grid model (axis bounds, rows from the doctor's slot length, block clipping, lanes for overlaps), the move
  target href.
- e2e `tests/e2e/schedule/calendar.spec.ts` (desktop-chrome, pixel-7, iphone-15; `--retries=0`): AC-1..AC-7 (grid cases skip below 768 px, the fallback
  case runs there).
- Affected existing: `schedule/*`, `perf/latency-pages` row selector, `tests/schedule/*`, `design/screens/schedule` if its screenshots move.
