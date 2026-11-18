# 06-02c record: data display (2c) and date, time and identity inputs (2d)

Plan: `06-PLAN.md` § 06-02c (Wave 7, after G2-D). Under the speed ruling this is UI work: one independent review
afterwards, and Lows only if cheap. Branch `v2/phase-06-design-system-pwa-shell`, plan base `9e721fe` (06-02b's last
commit). Design contract: `06-UI-SPEC.md` (CTO defaults CD-01…CD-37 binding; rows "06-02c Data display and dates").
Visual reference: V2-DX `3a78a5d` (`shared/sketch.css` "Data table / list", "Empty, loading", `.banner`;
`006-components/index.html` "Empty, loading, banners, alerts"). Every number below is tool output: a file in
`evidence/06-02c/` or the command named in the row. Builds and e2e ran in this worktree under the shared e2e lane lock
with an owner file (`scratchpad/lane-02c.sh`: `mkdir` lock, owner file, waits for the shared stack's test-run lock to
have no live holder, port 3100 checked free, released on exit). The local stack was not reset or stopped.

## What changed

| Area | Change | Files |
|---|---|---|
| Dependency | `react-day-picker` **10.0.2** exact (the plan's pin, published 2026-09-30), installed with `--before=2026-10-01 --ignore-scripts`. `scripts/ci/lock-linux-check.sh --fix` rewrote the lock with Linux npm (PASS): exactly one new entry; its `date-fns ^4.1.0` and `@date-fns/tz ^1.4.1` dedupe onto the existing 4.4.0 / 1.5.0 (`npm ls`: "deduped", no second copy). Legitimacy record `plans."06-02c"`: 1 package, integrity equal, no install scripts, 0 problems; `npm audit signatures`: 988 verified. | `package.json`, `package-lock.json`, `evidence/package-legitimacy.json` |
| Date formats | `lib/datetime/format.ts`: `12 Nov 2026`, `Thu, 12 Nov 2026`, `Thursday, 12 November 2026` (accessible names), `Mon 16`, `November 2026`, `11:30 am`, `dd/mm/yyyy` in and out (never mm/dd), counts with Indian grouping (`1,24,000`). Names are the CLDR en-IN ones held as tables (see Deviations 2). A clinic date is formatted from the calendar date itself: no zone is read. | `lib/datetime/format.ts` |
| Calendar | react-day-picker in the clinic's zone (`timeZone` from `ClinicTimeZoneProvider`, `noonSafe` date maths), `enIN` labels replaced by ours, weeks from Sunday (`weekStartsOn={0}`: date-fns' `enIN` says Monday; CD-24 says CLDR en-IN Sunday). Header "November 2026" (title-3, a polite live region) with Previous / Next month buttons (IconButton look, 36 / 44 touch). Days 36 px (44 touch), radius-sm, tabular; today accent-fg 600; selected accent fill with white text; outside min/max disabled. Days outside the month are not drawn (Deviations 5). Each day button is named "Today, Thursday, 12 November 2026, selected". | `components/ui/calendar.tsx` |
| DateField | One text field typed as `dd/mm/yyyy` (slashes added as you type; `1/2/2026` and a pasted ISO date also work; `inputmode="numeric"`), read on blur and as soon as the year has four digits; a non-date or a date outside min/max keeps the text, marks the field invalid and says what to do ("Enter the date as dd/mm/yyyy", "Enter a date on or before 12 Nov 2026"). The picked date reads `Thu, 12 Nov 2026` under the field and is part of its description. "Choose date" (bordered IconButton) opens the Calendar in a Popover on the picked day, else today; Enter picks; Escape closes; focus always returns to the text field. `quickPicks` adds the "Today" / "Tomorrow" chips. Inside a `Field` it takes the label, id and description. | `components/ui/date-field.tsx` |
| DayStrip | Today, Tomorrow, then `Mon 16` … as single-select chips (`radiogroup`, roving focus, wrap, Home/End), scrolling sideways; each name carries the full date ("Tomorrow, 13 Nov 2026"). Takes `today` from the caller (`useClinicToday()`). | `components/ui/day-strip.tsx` |
| SlotPicker | Morning / Afternoon / Evening groups (one `radiogroup` each, one choice across the day), chips min-width 92, tabular `11:30 am`; full slots hidden until "Show full slots"; a full slot reads "10:00 am, full" and picking it shows the warning Alert "This slot is full … 3 of 3 booked. Booking it overbooks the slot."; "No free slots on this day". Presentational (slots as props). | `components/ui/slot-picker.tsx` |
| PhoneInput | Restyled onto `Input` with a "+91" start adornment (the flag emoji is gone), `kind="tel"` (numeric keypad, `tel-national`, `enterKeyHint` next), 36 / 44 touch, 16 px on touch. The v1 logic is unchanged: `cleanPhoneInput`, `normalizePastedPhone`, `extractTenDigits`, the `onChange(tenDigits, e164)` contract, every v1 prop. | `components/ui/phone-input.tsx`, `tests/components/phone-input.spec.ts` (rendering cases updated: no flag, adornment, input kind, tokens) |
| AgeOrDobInput, `lib/ui/age.ts` | SegmentedControl "Age" / "Date of birth". Age: a numeric Input and an "Age unit" NativeSelect (years, or months below 2 years); hint "Born about 1984" / "Born about Mar 2026"; value reported as an approximate DOB (1 Jan of the birth year: the convention of `features/patients/schema.ts`, so the server and this control agree and round-trip). Date of birth: a DateField (max = the clinic's today); hint `42 y`, `8 m`, `12 d`. `lib/ui/age.ts`: `ageParts`, `formatAge`, `formatAgeToday`, `dobFromAge`, `parseAgeAmount`; the year count always equals `lib/datetime` `ageInYears` (29 Feb birthdays reach their year on 1 Mar). | `components/ui/age-or-dob-input.tsx`, `lib/ui/age.ts` |
| DataTable, DataList, DataView | One column model (`DataColumn`: header, cell, numeric, sortable, list placement). Table (≥ lg): header surface-soft, 11/600 caps, sticky; body-sm cells 8 12, hairlines, tabular, numbers right-aligned; primary cell is a link; row actions (one inline + ⋯) always visible; sortable headers are buttons, `aria-sort` on the `<th>`. List (< lg): two-line rows (title link + status; meta with " · "), actions at the right, "Load more" (focus moves to the first new row). States: loading (5 skeleton rows + a "Loading patients" status), empty (EmptyState in the body), error (danger Alert + Retry), stale (warning "Showing data from 10:42 am" + Retry). `DataView` switches by CSS at 1024 px. | `components/ui/{data-table,data-list,data-view}.tsx` |
| Pagination | "Showing 1–25 of 1,240" (polite live region, Indian grouping) + Previous / Next secondary `sm` in a named `nav`; links with `hrefFor(page)` (page in the URL) or buttons with `onPageChange`; a disabled end hands focus to the other button. | `components/ui/pagination.tsx` |
| SearchField | Input kind `search` with the Search icon, "Clear search" while non-empty (the browser's glyph hidden), Escape clears (stops the key only when it cleared something), focus kept; `onSearch` 200 ms after typing stops, at once on clear and Enter. | `components/ui/search-field.tsx` |
| FilterChip, FilterBar | Applied filters as selected chips with "Remove filter Doctor: Dr Rao" (24 px, 44 touch); "+ Filter" dashed ghost chip opening a Popover; "Clear all" link. Focus after a removal: the next chip's X, else the previous, else "+ Filter"; after Clear all: "+ Filter". | `components/ui/filter-chip.tsx` |
| Skeleton, EmptyState, Alert, Banner | Skeleton: `border`-fill blocks, `motion-safe:animate-pulse` only, `SkeletonRegion` announces once. EmptyState: icon 24 fg-icon, 14/600 title, one sentence, action + optional secondary (v1 props kept). Alert: four tones, icon per tone, title + text + action, `status` for info/success and `alert` for warning/danger (v1 `type="error"` call sites keep `role="alert"`), `live="off"` for a notice present from the start. Banner: trial / past-due / offline component tokens. | `components/ui/{skeleton,empty-state,alert,banner}.tsx` |
| v1 adapters | `empty-state`, `alert`, `table`, `phone-input` keep their exports and props; the 14 v1 files that use them (Today, the patient list, registration and edit, the booking, waitlist and walk-in drawers, settings and profile forms, the developer pages, the cabin view) compile unchanged and now draw on semantic tokens (UI policy `raw-palette` 3477 → 3445). | `components/ui/{empty-state,alert,table,phone-input}.tsx` |
| Gallery | `/dev/ui` sections "Data display" and "Dates, times and identity inputs": live specimens for every component and state (DataView with a state switch: ready, loading, empty, error, stale; sorted headers; search with a search counter; filters; pagination at both ends; skeleton; two empty states; four alerts; three banners; DateField default / unbounded / DOB / error / disabled; inline Calendar; DayStrip; SlotPicker with free, full and none; PhoneInput default / invalid / disabled; AgeOrDobInput). The date specimens render after hydration (they depend on the clinic's today; Deviations 4). Synthetic copy only; no "AI" copy. | `app/dev/ui/sections/{data,dates}.tsx`, `app/dev/ui/page.tsx` |
| Contrast | 4 new pairs (unsorted-header glyph, secondary text on a hovered row, disabled calendar day and skeleton block informational). Report regenerated by the tool: **215 pairs, 0 fail**. | `lib/design/contrast-pairs.ts`, `evidence/06-01b/contrast.md` |

## Commits

| Commit | What |
|---|---|
| `f1f8358` | `react-day-picker` 10.0.2 exact pin, Linux lock, legitimacy record |
| `064c75b` | The 2c/2d primitives, `lib/datetime/format.ts`, `lib/ui/age.ts`, the v1 adapters, the gallery sections, `keyboard/data-and-dates.spec`, `data-dates-axe.spec`, the unit specs, 4 contrast pairs |
| `0d19d0d` | `data-dates-axe.spec` also checks 16 px text on touch and the numeric keypad on the date, age and mobile fields |
| `8049442` | DayStrip scrolls only itself (never the page) to the selected day (`scrollIntoView({block: "nearest"})` would also scroll the page to a strip below the fold) |
| `1138294` | The DayStrip case asserts the picked chip stays inside the strip; `8049442`'s page-`scrollY` assertion failed in the PR lane for a reason outside the DayStrip (cmdk, see Open) |
| `5ed20e6` | DataList rows in body-sm (the status cell had inherited 16 px); the inline gallery Calendar fits its 328 px column at 360 px (8 px padding on touch). Both seen in the 360 px captures |
| (this commit) | Record, evidence, wave notes |

## Acceptance (plan § 06-02c "Tests that fail without the change", "UI checks", "Acceptance mapping")

| Criterion | Result | Proof |
|---|---|---|
| Tracer: DateField + Calendar popover (react-day-picker, clinic time zone from `ClinicTimeZoneProvider`, dates through `lib/datetime`, `12 Nov 2026`) in the gallery + keyboard case | Met. Built and run first (build → `keyboard/data-and-dates.spec` DateField cases). The first run found two real problems before anything else was built: ICU punctuation differs between Node and Chrome (Deviations 2), and Playwright's clock breaks `TZDate` (Flaky-test root causes 1). | `evidence/06-02c/e2e-pr.txt` |
| `data-and-dates.spec.ts`: Calendar arrow-key grid navigation, PageUp/PageDown months, Enter selects, Escape closes and focus returns to the field | Met, keyboard only: Tab to "Choose date", Enter opens the grid on the clinic's today (named "Today, Thursday, 12 November 2026"), the approved ring on the focused day; ArrowRight/Down/Left/Up, Home (Sunday) / End (Saturday), PageDown / PageUp (the grid's name follows: "December 2026", "October 2026"); Enter picks, the popover closes, focus is in the text field, its value `14/11/2026` and description "Sat, 14 Nov 2026"; reopened on the picked day ("…, selected"); Escape closes without a change and returns focus to the field. Days after `max` are disabled and the keyboard cannot land on them. | PR lane |
| A date picked at 23:30 IST stays on the clinic date | Met in two browser zones with the clock frozen at 18:00Z (23:30 IST): **UTC+14** (`Pacific/Kiritimati`, where the browser's own date is already 13 Nov): the calendar's today, Enter, Today/Tomorrow chips (12 / 13 Nov), the DOB max ("Enter a date on or before 12 Nov 2026"), the DayStrip ("Today, 12 Nov 2026") and the age hint (13 Nov 1984 → "41 y") all use 12 Nov. **IST** itself (where a UTC `toISOString()` cut would give the day before): a picked 19 Nov stays `2026-11-19` / "Thu, 19 Nov 2026"; at 00:30 IST the grid opens on 13 Nov although UTC is on 12 Nov. A mutant Calendar without the clinic zone fails the UTC+14 case at its first calendar assertion (opened on "October 2026"). | PR lane; `evidence/06-02c/mutant-calendar-zone.txt`, `clock-probe.txt` |
| DataTable header sort toggles `aria-sort` | Met: Enter and Space on the "Patient" header button set its `<th>` to `ascending` then `descending` (the previously sorted "Last visit" goes to `none`; an unsortable header has no `aria-sort`), the first row follows (01 → 05), focus stays on the button with the approved ring; numbers right-aligned (computed `text-align: right`); row actions visible without hover. States: loading (5 skeleton rows, `aria-busy`, a "Loading patients" status), empty (EmptyState in the table), error (`role="alert"` + Retry that recovers), stale ("Showing data from 10:42 am" + Retry). Below lg: the same model as a list; Load more adds rows and moves focus to the first new one. | PR lane |
| Pagination and FilterChip keyboard | Met. Pagination: "Showing 1–25 of 1,240" (Indian grouping), Next/Previous by keyboard, Previous disabled on page 1 and focus handed to Next when Previous disables itself; "Showing 26–48 of 48" with Next disabled. Filters: Enter on "Remove filter Doctor: Dr Rao" removes it and focuses the next chip's X; the last chip's removal focuses the previous one; "+ Filter" opens its popover (`aria-expanded`) on its first option, picking one closes it and focus returns to "+ Filter"; "Clear all" focuses "+ Filter". SearchField: one search 200 ms after a burst of typing, Escape and "Clear search" empty it and keep focus. | PR lane |
| DayStrip roving focus | Met: the radiogroup starts on the checked "Today" chip; ArrowRight roves (no selection), Space picks ("2026-11-13"); End jumps to "Wed 25 Nov 2026" (in view), arrows wrap both ways, Home returns; the page does not scroll when the strip mounts. | PR lane |
| `age.spec.ts`: age from DOB and DOB from age on IST date boundaries (00:00-05:30 IST), leap-day DOB | Met: 20 tests. A birthday is counted at 00:30 and at 05:29 IST while UTC is still on the previous day (`42 y`, not `41 y`), the minute before IST midnight is still the day before, an infant's month count turns at IST midnight, DOB from age uses the clinic's year at the IST new year; 29 Feb DOBs reach their year on 1 Mar (`11 m` on 28 Feb 2025, `1 y`/`12 m` on 1 Mar); the year count equals `ageInYears` for every DOB in 2023-2024 on six clinic dates (4,386 checks); `dobFromAge` round-trips with the server's `calculateAgeFromDob`; months clamp to month ends (31 Mar − 1 m = 28 Feb, 29 Feb in 2024). | `npx vitest run tests/design/age.spec.ts` (in the full lane) |
| Gallery axe 0 serious/critical; M0 e2e green | Met: `/dev/ui` whole page at 360/820/1180/1280 0 serious/critical (`gallery-axe.spec`); the data and dates sections, and the page with the Calendar open, 0 violations of any impact at every width (`data-dates-axe.spec`). Every `m0/*` spec green on the PR projects, including registration and walk-in, the v1 users of the restyled PhoneInput, Alert and EmptyState. | `evidence/06-02c/data-dates-axe.json`, `e2e-pr.txt` |
| UI checks: data and date sections at 360/820/1180/1280 (DataList at 360/820, DataTable at 1180/1280); axe | Met by `data-dates-axe.spec.ts`: DataList visible and the table hidden at 360/820, the reverse at 1180/1280; no horizontal scroll (also with the calendar open); the popover inside the viewport; below 1024 px every control in both sections and every calendar day ≥ 44 × 44 (days exactly 44), and every text field ≥ 16 px; on a fine pointer ≥ 24 × 24 (days 36); the date, age and mobile fields have `inputmode="numeric"` and an Enter-key hint. Captures checked by eye at 360 and 1280 against the approved component sheet. | `evidence/06-02c/data-dates-axe.json`; `design-captures/06-02c/{gallery-data,gallery-dates,calendar}-{360,820,1180,1280}.png` (git-ignored) |
| Acceptance mapping: P1-28 M2 2c/2d (MoneyInput with V2-10, R-15); gallery axe and keyboard (2c/2d part) | Met (rows above). MoneyInput and InvoiceLines are not built (R-15). | |

## Flaky-test root causes and test-harness findings (this plan's own runs)

No test passed only on retry: every run used `--retries=0`. Two findings from the first runs, both root-caused:

1. **Playwright's `page.clock` breaks `TZDate`** (deterministic, not a flake). The first tracer run with
   `page.clock.setFixedTime(18:00Z)` in a UTC+14 browser had the calendar open on 13 Nov and "Tomorrow" give 14 Nov.
   The product was right: the clock was wrong. A probe outside the app (`evidence/06-02c/clock-probe.txt`, source
   alongside) shows `new TZDate(18:00Z, "Asia/Kolkata").getDate()` is 12 with the real clock, 13 under
   `page.clock.setFixedTime`, and 13 again with a `class FrozenDate extends Date` stand-in. Playwright's fake `Date`
   returns a plain native Date from its constructor, so the `TZDate` subclass loses its prototype; and `TZDate`
   proxies the methods it finds on `Date.prototype`, which a subclass prototype does not have. Fix (test side):
   `freezeClock()` builds dates with `Reflect.construct(NativeDate, args, new.target)` and shares the native
   prototype, so only `Date.now()` and `new Date()` change; the probe gives 12 with it. Wave note added.
2. **Hydration and a frozen clock.** With the browser clock frozen and the server on the real clock, anything that
   renders "today" would differ between server and browser markup. The gallery's date section therefore renders after
   hydration (Deviations 4), so the date specs never meet a hydration mismatch.

Lane notes: twice a run stopped at global setup with "Another test run (pid …) is using the local stack" (a V2-05 run
started between checks); `lane-02c.sh` now also waits for the stack's test-run lock to have no live holder before
it starts. Those runs never reached a test and were repeated; they are not flakes.

## Suite results (local)

| Check | Result |
|---|---|
| `npm run typecheck` | Clean (app + tests) |
| `npx eslint .` | 0 errors. 457 warnings, the same count as 06-02b; 0 in 06-02c's files (`evidence/06-02c/static-checks.txt`). The one `jsx-a11y/no-autofocus` site (the Calendar grid takes focus only when opened from "Choose date") carries a disable comment with that reason |
| `npm run inventory` | 0 flagged |
| `node scripts/ci/ui-policy.mjs` | PASS; enforced rules 0 findings. Report-mode counts only fall: `raw-palette` 3477 → 3445 (the v1 adapters), `arbitrary-color` 2, `px-font` 281 |
| `npm run ci:ai-l1` | PASS (the 4 waivers are pre-existing) |
| `node scripts/design/contrast.mjs` | 215 pairs, 0 fail |
| Vitest, targeted | `age.spec` 20, `datetime-format.spec` 8, `phone-input.spec` 16: all pass |
| Vitest, full lane (`npx vitest run`, shared stack, at `0d19d0d`; later commits change no unit-tested code) | **276 files, 5676 passed, 8 failed** (`evidence/06-02c/vitest.txt`). The 8 are outside this plan: the shared stack carries migrations 000079-000084 that this branch does not have yet (V2-05b), so `membership-guard` SEC-09 ×3 (PGRST202, the stack's `generate_daily_queue_token` signature) and `role-rls` clinical_notes ×3 (PGRST204, the legacy visits columns are gone on the stack) fail, plus the known `hosted-dump-diff` ×2. `git diff --stat 9e721fe..HEAD -- supabase tests/security tests/ci` is empty. Re-run after the 05b merge-in |
| `npm run e2e:pr -- --retries=0` (build `5ed20e6`, lane lock) | **374 passed, 0 failed, 0 flaky, 102 skipped, 0 retried**: desktop-chrome 255 (06-02b: 235; +20 = 16 keyboard + 4 axe cases), pixel-7 96 (+102 skipped by design: the 06-02c cases are desktop-only), iphone-15 18, setup 5 (`evidence/06-02c/e2e-pr.txt`, from the JSON reporter). Earlier full runs: `064c75b` 374/0/0; `8049442` 373 + 1 failed (the page-`scrollY` assertion, see Commits `1138294`); `1138294` 374/0/0 |
| `npm run e2e:design -- --retries=0` (build `8049442`) | **105 passed, 0 failed, 16 skipped** (`evidence/06-02c/design-lane.txt`). `5ed20e6` changes only the DataList text size and a gallery wrapper, outside the design-lane specs |
| Repeat run of the 06-02c specs | `keyboard/data-and-dates` + `data-dates-axe`, `--repeat-each=3 --retries=0`: **65 passed** (20 × 3 + setup), 0 failed (`evidence/06-02c/repeat-run.txt`). After `5ed20e6`: the same specs + `gallery-axe` once more, 30 passed |
| Lockfile | `lock-linux-check.sh --fix`: PASS. Legitimacy `plans."06-02c"`: 0 problems. `npm audit signatures`: 988 verified |
| gitleaks | `evidence/06-02c/gitleaks.txt` |

## Deviations

1. **Files outside the order-table row**, each needed by the plan text, the UI-SPEC or a bug:
   - `lib/datetime/format.ts` (+ `tests/utils/datetime-format.spec.ts`): the plan formats dates "through
     `lib/datetime`", which had no display formatters.
   - `components/ui/data-view.tsx`: the ≥ lg / < lg switch in its own file, so `data-table` and `data-list` share the
     column model without an import cycle.
   - `tests/e2e/design/data-dates-axe.spec.ts`: the plan's "UI checks" at four widths.
   - `tests/components/phone-input.spec.ts`: its rendering cases asserted the flag emoji and v1 classes; they now
     assert the "+91" adornment, the input kind and the tokens (the logic cases are unchanged and pass).
   - `lib/design/contrast-pairs.ts` and the regenerated `evidence/06-01b/contrast.md` (UI-SPEC: new pairs in the same
     commit; the report is tool output).
2. **en-IN names from tables, not `Intl` at run time.** Chrome's en-IN gives "Thu, 12 Nov, 2026" where Node gives
   "Thu, 12 Nov 2026" (the tracer's first run). The server renders with Node and the browser hydrates with its own
   ICU, so the same date must give the same string in both. The tables hold the CLDR en-IN names (a unit test
   compares them with Node's `Intl` for every month and weekday), including "Sept". Counts still use
   `Intl.NumberFormat("en-IN")`.
3. **One implementation commit**, as in 06-02b: the tracer (DateField + Calendar + its keyboard cases) was built and
   run first and found the two issues above, but its files are shared with the rest of 2d (the dates section, the
   formatters), so splitting them afterwards would have produced commits that never ran.
4. **The gallery's date specimens render after hydration.** They all depend on the clinic's "today", which the server
   computes from its clock and the browser from its own; the date specs freeze the browser's clock near an IST
   midnight. Rendering after hydration keeps the two markups from ever disagreeing. The product components render on
   the server as usual.
5. **Calendar days outside the month are not drawn.** The UI-SPEC styles them fg-disabled, but react-day-picker makes
   them enabled buttons, and fg-disabled text on white is 2.09:1 (axe `color-contrast`, serious, on enabled
   controls). PageUp/PageDown and the arrows still cross months.
6. **DateField is one masked text field, not three segment inputs.** "Segmented `dd / mm / yyyy` typing" is met as the
   shape: the slashes appear as you type, `d/m/yyyy` and a pasted ISO date are read. One tab stop, paste works and a
   screen reader reads one value; three inputs would need custom focus jumping and lose paste.
7. **AgeOrDobInput's unit is a separate "Age unit" NativeSelect** ("years" / "months"), not a "y" adornment inside the
   input. A select inside the input's box cannot be 44 px tall (the box's borders leave 42), and an adornment that
   changes with the value would not say how to enter months. Same look family (NativeSelect), 44 px on touch.
8. **PhoneInput keeps the 10 digits ungrouped in the field** (`maxLength` 10, v1 logic unchanged as the plan says); the
   `+91 98765 43210` grouping is the read-only display (`formatTenDigitsDisplay`).
9. **Selection on Space/Enter in DayStrip and SlotPicker.** They use 06-02a's ChipGroup (Radix ToggleGroup, single):
   arrows move focus, Space or Enter selects. The WAI-ARIA radio pattern moves selection with focus; RadioGroup and
   SegmentedControl do. Kept for consistency with ChipGroup (a day or slot change can trigger a fetch in V2-08);
   listed for the G3 reviewer.
10. **`Alert` has a `live` prop** (`"status" | "alert" | "off"`) rather than `role={null}`, which `jsx-a11y/aria-role`
    rejects.

## Open (owner)

- **v1 `components/patients/age-dob-input.tsx`** (native `type="date"` and `type="number"`) stays on the registration
  and edit forms; V2-08 moves them to `AgeOrDobInput` / `QuickRegisterForm` (06-03b). Backlog row proposed.
- **DataList has no sort control**: below lg the order is the table's. Add a "Sort by" NativeSelect when a list screen
  needs it (V2-08 patients). Low.
- **Calendar year navigation** for a date of birth is typing or Shift+PageUp/PageDown (a year at a time); a year
  dropdown (`captionLayout`) can come with V2-08 if reception asks for it. Low.
- **Vitest stack-ahead failures** (8): re-run after the 05b merge-in (orchestrator).
- **An inline `Command` scrolls the page to itself on load.** The gallery loads at `scrollY` 4758 (1280 px): cmdk
  calls `scrollIntoView({block: "nearest"})` on its first group heading and active item when it mounts (probe:
  `evidence/06-02c/scroll-probe.txt`; the DayStrip makes no such call). Harmless in the palette dialog; a page with an
  inline Command (06-03b's RxEntryRow combobox on the consult) would jump to it. Owner: 06-03b (or 06-02b's
  `Command` wrapper). Wave note added.
- `freezeClock()` lives in the spec; move it to `tests/e2e/support/` when a second spec needs it.
- `scripts/ci/ui-policy-baseline.json` is not refreshed (06-08 owns it); 06-02c's counts only fall.
