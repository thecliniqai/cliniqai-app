# 03-05 record: `lib/datetime` + the UTC "today" sites (P1-21, ADR-016, FE-6)

**Outcome:** done locally. The repo-wide ban and the `utc_today_messages` counter are 03-04, as the plan says.
**Commits (03-05 only; 03-07 committed in between on the same branch):**

| SHA | Subject |
|---|---|
| `aca6b4e` | chore: pin `date-fns` 4.4.0 and `@date-fns/tz` 1.5.0 (lock written by Linux npm) |
| `5f28a1f` | feat: `lib/datetime` (isomorphic), `lib/datetime/server.ts`, `lib/datetime/client.tsx` |
| `02743ee` | fix: clinic dates in the tenant zone at every site; new and updated specs |
| `2629b1c` | ci: `TZ=America/New_York` re-run of `tests/utils/datetime.spec.ts` in the `test` job |
| `a84b6a1` | test: e2e `appToday()` is the clinic date (the walk-in flow characterised the UTC date) |
| (next) | docs: this record, evidence, wave notes |

**Evidence:** `evidence/03-05/`, all tool output.

| Check | Result | File |
|---|---|---|
| Census before (`census.sh 45e1c40`: `git grep` over `app components features lib`) | A 27, B 10, C 24 lines | `census-before.txt`, `census.sh` |
| Census after (`census.sh 2629b1c`, and at `a84b6a1` with 03-07 merged) | A 0, B 0, C 0 | `census-after.txt`, `census-after-a84b6a1.txt` |
| New specs on the pre-change code (worktree of `45e1c40` + the two specs + `lib/datetime`, `TZ=UTC`) | 5 failed, 16 passed | `boundary-specs-before-45e1c40-tz-utc.txt` |
| Same specs on `2629b1c`, `TZ=UTC` | 21 passed | `boundary-specs-tz-utc.txt` |
| `TZ=America/New_York npx vitest run tests/utils/datetime.spec.ts` (the CI step) | 17 passed | `datetime-tz-new-york.txt` |
| Full Vitest lane, clean worktree of `2629b1c`, DB reset to that commit's migrations | 126 files, 2207 passed, 0 failed, 0 skipped; report gate PASS | `vitest-full.json`, `vitest-report-gate.txt` |
| `npm run e2e:build && npm run e2e:pr`, clean worktree of `a84b6a1` | 128 passed, 0 flaky/retried, 0 failed (desktop-chrome 65, pixel-7 49, iphone-15 9, setup 5) | `playwright-results.json`, `playwright-summary.txt` |
| typecheck, eslint, inventory, workflow policy (main checkout at `a84b6a1`) | exit 0; eslint 0 errors, 422 warnings | `static-checks.txt` |
| `scripts/ci/lock-linux-check.sh` after the lock change | PASS (Linux npm 11.19.1, `npm ci --dry-run`) | run before `aca6b4e` |
| gitleaks v8.30.1, full history | no leaks found | `gitleaks.txt` |

Census categories (regexes in `census.sh`): **A** `toISOString()` followed by `.split("T")[0]` / `.slice(0, 10)` /
`.substring(0, 10)`; **B** any other `.split("T")[0]` (a stored timestamp cut to its UTC date); **C** `T00:00:00Z`,
`T23:59:59.999Z` and `+05:30` literals. Research counted 25 + 9 + 9 *sites*; the census counts *lines* at `45e1c40`:
A has two sites added after the research (`app/api/v1/lab-orders/route.ts:214`, `features/api-keys/service.ts:44`);
B's 10 lines are its 9 sites (`doctor-timeline.tsx` has 2); C's 24 lines are the 17 day-window lines plus the 7
`+05:30` lines of `block-time-modal.tsx` (R-24 erratum input for 03-SUMMARY).

## What shipped

- **`lib/datetime/index.ts`** (isomorphic, no environment, no process or browser zone): `DEFAULT_CLINIC_TZ`,
  `todayInTz(tz, now?)`, `ymdOf(instant, tz)`, `addDaysYmd`, `startOfMonthYmd`, `nextNDays(tz, n, now?)` (tomorrow
  first), `weekdayOfYmd`, `dayWindowUtc(ymd, tz)` / `rangeWindowUtc(start, end, tz)` → `{ startIso, endIsoExclusive }`
  (half-open, built on `TZDate`, DST-correct), `zonedDateTimeToUtcIso(ymd, "HH:mm[:ss]", tz)`, `isYmd` (real calendar
  dates only), `isValidTimeZone`, `resolveTimeZone`, `ageInYears`.
- **`lib/datetime/server.ts`** (`server-only`): `getTenantTimeZone(db, tenantId)` reads `tenants.timezone` with the
  caller's client (RLS); missing/unusable value or a failure → `Asia/Kolkata`, a failure logged as
  `datetime.tenant_tz.failed` with `code` only. `getTenantToday` returns `{ timeZone, today }`.
- **`lib/datetime/client.tsx`**: `ClinicTimeZoneProvider` (mounted by `app/(dashboard)/layout.tsx`, which reads
  `tenants.timezone`) and `useClinicTimeZone()` / `useClinicToday()`.
- **Server sites:** queue check-in passes the clinic date to `generate_daily_queue_token` and the `queue_tokens` row;
  lab `report_date` default in `uploadLabDocument` and `/api/v1/lab-orders`; API usage bucket in
  `authenticateApiKey` and `listApiKeys` (same rule both sides); visits/queue/cabin/schedule-block/slot-check/report
  windows are clinic days, half-open (`.lt(endExclusive)`); visit register presets (`computeDateRange` now takes the
  zone and returns `endIsoExclusive`); Rx `visit_date` (×3), referral snapshot dates, waitlist auto-promotion day,
  receipt date (payload carries `clinic.timezone`); slot-check shift lookup uses the tenant zone; dashboard, queue,
  calendar, cabin and billing-report pages default to the clinic today; an invalid `?date=` falls back to it.
- **Client sites:** calendar and queue date navigation/"Today", booking-drawer and block-time defaults, block-time
  instants (`+05:30` literals → `zonedDateTimeToUtcIso`), all-day block dates on the timeline, follow-up dates,
  DOB `max` and age, lab report date, referral return date, collection-report presets.
- **`features/patients/schema.ts`:** age/DOB helpers take the clinic date (default: today in `Asia/Kolkata`, used by
  the zod transform on the server).
- **CI:** `test` job step `TZ=America/New_York npx vitest run tests/utils/datetime.spec.ts`.
- **Unchanged by ruling R-33:** SQL `DEFAULT CURRENT_DATE` on `queue_tokens.date` / `patient_documents.report_date`
  (V2-05 05-08) and the invoice-number year `features/billing/service.ts:144` (V2-10 P1-06). No migration.

## Tests that fail without the change

- `tests/utils/datetime.spec.ts`: 18:29:59Z → `2026-11-12`, 18:30:00Z and 23:59:59Z → `2026-11-13`, every minute of
  00:00–05:29 IST; fake clock 2026-03-01T19:00Z → `2026-03-02`, 18:29Z → `2026-03-01`; `dayWindowUtc("2026-11-13",
  IST)` = `2026-11-12T18:30:00.000Z` / `2026-11-13T18:30:00.000Z`; month/year/leap rollover; DST day in New York;
  age on the IST birthday; visit-register presets at 00:30 IST. Pre-change: 2 fail (age 35 vs 36; the old
  `computeDateRange`).
- `tests/integration/ist-boundaries.spec.ts` (DB lane, `vi.setSystemTime(2026-11-12T19:00:00Z)`, Date only): check-in
  token dated `2026-11-13` (pre-change `2026-11-12`); a 02:00 IST visit is in the 13 Nov visits and queue lists and
  not in 12 Nov (pre-change: absent from 13 Nov); a lab document without a date is dated `2026-11-13` (pre-change
  `2026-11-12`); an `America/New_York` tenant still gets `2026-11-12` (guards against a hard-coded IST).
- Existing specs whose expectations encoded the UTC day were moved to the clinic day:
  `tests/visits/clinic-visits-register.spec.ts` (preset boundaries), `visit-service-guards.spec.ts` (window string),
  mock chains `lte` → `lt` (`availability-blocks`, `calendar-scheduling-ux`, `phone-search`), and test-side "today"
  in `queue-flow`, `receipt-reports`, `v1-auth` and e2e `appToday()`. These failed when run at 05:10 IST against
  the new code, which is the defect the plan removes.

## Deviations

1. **Client zone via context, not a prop (plan step 2).** `AgeDobInput` sits under 5 parents and
   `app/(dashboard)/patients/new/page.tsx` is a client page with no server parent, so the dashboard layout (server)
   provides `tenants.timezone` through `ClinicTimeZoneProvider`. Same source, the browser zone is still never used.
2. **Public reschedule link uses `DEFAULT_CLINIC_TZ`, not the token tenant's zone.** `get_reschedule_context`
   returns no zone and 03-05 has no migration. "Tomorrow" and the 5-date list are clinic-zone dates; slot generation
   stays UTC wall-clock (P1-20, V2-08, "IST slots"), so the booked-slot window is that UTC day
   (`RESCHEDULE_SLOT_TZ = "UTC"`, named in the route). Moving only the window would offer booked evening slots.
3. **Rule 2 hardening:** invalid `?date=` on dashboard pages falls back to today; `getDailyCollectionReport` refuses
   a non-calendar date with a fixed message (was a `RangeError` text).
4. **Test-only fixes** listed above (expectations that encoded the UTC day).

## Residuals (handed on in the wave notes)

- Calendar timeline wall-clock placement (`getHours()`), the booking drawer's instant
  (`new Date(\`${date}T${time}:00\`)`) and `components/cabin/doctor-cabin-view.tsx:141` still use the browser zone
  for time of day (correct only in a browser set to the clinic zone; the e2e specs pin `Asia/Kolkata`). Not "today"
  sites; candidates for V2-08 P1-20 / FE.
- Hard-coded `Asia/Kolkata` display/messages: `features/visits/scheduling-service.ts` booking message,
  `features/appointments/system.ts`, `consume_reschedule_token` text, `lib/messaging/governance.ts` quiet hours
  (fixed IST offset).
- One `tenants` read per affected service call (no request cache); V2-05 may carry the zone in `ServiceContext`.
- UI: no markup or layout changed (values only); e2e covered desktop, Pixel 7 and iPhone 15 incl. the axe specs; no
  separate 820 px pass was made.
- Shared stack: the clean full lane needed `db reset --local` from the `2629b1c` worktree (lock held), which dropped
  03-07's `000027` until they re-applied it (their wave-note row).
