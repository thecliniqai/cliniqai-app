# 06-03b record: clinical entry patterns

Plan: `06-PLAN.md` § 06-03b (Wave 9, after G2-D). UI work under the speed ruling: one independent review afterwards,
Lows only if cheap. Branch `v2/phase-06-design-system-pwa-shell`, plan base `9683e79` (06-03a's last commit). Design
contract: `06-UI-SPEC.md` rows "06-03b Clinical entry"; CTO defaults CD-03, CD-04, CD-07, CD-18, CD-32, CD-33 and
CD-34 apply here; the PO preference (tap-first, near-zero typing for doctors, dense but never cramped). Visual
reference: V2-DX `3a78a5d` (`004-consult/consult.{js,css}`: the Rx combobox, `drawDose()`, `.rx-line`; the
`consult-rx` and `states/consult-dose-builder` captures). Every number below is tool output: a file in
`evidence/06-03b/` or the command named in the row. Builds and e2e ran in this worktree under the shared e2e lane lock
with an owner file (`scratchpad/lane-03.sh`); the local stack was not reset or stopped.

## What changed

| Area | Change | Files |
|---|---|---|
| Command wrapper (06-02c open item) | **An inline Command no longer scrolls the page.** cmdk 1.1.1 calls `scrollIntoView({ block: "nearest" })` on the active option and on the first group heading, also when it auto-selects on mount. That scrolls every scrollable ancestor, so `/dev/ui` loaded at scrollY 4758 (`evidence/06-02c/scroll-probe.txt`), and a consult would jump to its Rx combobox. `CommandItem` and `CommandGroup` now give their nodes an own `scrollIntoView` (in the ref callback, which runs before cmdk's layout effect). It scrolls only the `[cmdk-list]` the node sits in (`scrollWithinCommandList`), so the arrow keys still keep the active option visible inside the list. Also new: `Command expanded` keeps the input's `aria-expanded` on the inline list's real state (cmdk always writes `"true"`), and `CommandItem multiline` lets a row wrap (patient names). | `components/ui/command.tsx` |
| Vitals lib | `lib/clinical/vitals.ts`: the default adult table per vital (unit, plausible range, decimals, low/high and critical limits; boundary rule `< low`, `>= high`). `parseVital` reads digits with one point or comma, never `parseFloat`'s prefix. `assessVital` → empty / invalid / implausible (with "Enter a value between {min} and {max}") / ok + flag. Also `flagWord`, `isCritical`, °C↔°F, `bmi` (null until both values are plausible), `bmiBand`, and the summary: `vitalsItems`, `summarizeVitals` (at most 3, flagged first). | `lib/clinical/vitals.ts` |
| Rx lib | `lib/clinical/rx.ts`: `Medicine`, `RxLine`, the presets (frequency `1-0-1 · 1-0-0 · 0-0-1 · 1-1-1 · SOS`, timing, duration 3/5/7/10/14/30 days). `frequencyWords` turns "1-0-1" into "morning 1, afternoon 0, night 1" (SOS = "when needed"; 4 slots, halves). Also `durationLabel`, `parseDuration` (`5d`, `2w` = 14, `1m` = 30), `clampDays` (1-365), `doseSummary` and `searchMedicines` (name prefix, generic prefix, word, substring). | `lib/clinical/rx.ts` |
| RxEntryRow, DoseBuilder | A combobox on `Command` (`shouldFilter={false}`, our ranking). The input is in an Input-skinned box with a Search icon; the placeholder is "Type a medicine or salt · Enter picks the top match". The listbox "Medicines" is a Popover skin (radius-lg, max 300 px, options 36 / 44 touch, generic and form in label fg-muted, active = `selected` + inset accent bar), plus the "Add “…”" create row. With no match it sits under the group heading "No medicine matches “…”". The list opens only while there is a query. Enter (or ↓ then Enter) opens the **dose builder** with the doctor's usual dose. **Focus stays in the search**, which now reads the dose keys: the first digit 1–5 picks the frequency, later digits plus `d`/`w`/`m` set the duration (the stepper shows "1…" while typing), Backspace edits them, and Enter adds the line, empties the search and keeps focus. "0d" or more than 365 days shows "Enter a duration from 1 to 365 days" (`role="alert"`). Any other character searches again; Escape closes. The builder has a hairline panel with radius-lg: head (drug 14/600, form · generic, Close), Frequency tiles with Kbd 1–5 hints (≥ lg, fine pointer), Timing tiles, Duration tiles plus a − N days + stepper (32 / 44 touch), an optional instruction (Enter adds), a polite summary ("1-0-0 · After food · 5 days"), Cancel and "Add to prescription" with Kbd ↵. Tap path: every field is a tile or a button. | `components/clinical/rx-entry-row.tsx`, `lib/ui/focus-box.ts` |
| RxLineItem | An `<li>` on the grid `20px · drug · how · remove`. The index; drug 500 + form; generic and instruction on line 2. Three option pills: the frequency pill is 600, tracking 0.04em, proportional figures, named "1-0-1, morning 1, afternoon 0, night 1. Edit dose of …"; then timing and "5 days". Each pill edits. The remove IconButton is named "Remove Paracetamol 650 mg"; the caller shows the 8 s Undo toast (CD-34). The "Repeated" marker stays until the line is reviewed. An allergy match turns the row `danger-bg` with "Matches allergy: Penicillin · Not on the prescription until you confirm". "Prescribe anyway…" opens a reason field, and an empty reason shows "Enter a reason to prescribe despite the allergy" (`aria-invalid`). Below 768 px the pills wrap under the drug. | `components/clinical/rx-line-item.tsx` |
| VitalsForm | Blood pressure (two inputs, "/", mmHg, one group), pulse, temperature (°F default; the °C switch converts the typed value), SpO₂, resp. rate, weight + height with "BMI 27.0 · Overweight" (polite), and blood sugar with Random / Fasting / PP. The "Last recorded …" line sits under the title. Inputs are `numeric`/`decimal` kinds (`enterkeyhint` next … done). Enter moves to the next field and submits from the last. Labels sit above below 768 and in a 120 px column from 768. Checks run on blur, then live. Flags are text plus icon: "High"/"Low" (warning), "Low · critical" (danger, OctagonAlert). Implausible values are field errors ("Systolic: Enter a value between 40 and 300"; diastolic ≥ systolic too). Only those block saving: the summary Alert "Fix 1 value before saving" appears and focus goes to the field. The sticky footer holds "Save vitals" (a submit Button, so disabled offline). `onSave` gets the reading in °F. | `components/clinical/vitals-form.tsx` |
| VitalsSummary | Activity 13 + at most three items ("BP 128/84 · P 88 · 98.6°F", label 12, tabular). A flagged item is danger 600 with the word ("BP 150/95 high"). With more than three, the line is a button that opens the full list in a Popover (each flag in words; critical says so). Nothing recorded: the "Vitals pending" outline chip. | `components/clinical/vitals-summary.tsx` |
| PatientPicker | A combobox on `Command`. Rows are the `inline` identity: name, `42 y · M`, masked phone, "Last visit 2 Oct". The active row shows its Enter action ("Add to queue"), and Enter runs `onPick`. The loading row ("Searching patients…", a labelled progressbar) sits next to the list. A late answer for an older query is dropped. The result count is announced ("1 patient"). No match: the group "No patient matches “9876”" with "Register as new patient". Escape clears. The search is the caller's (06-04b wires the server projection). | `components/clinical/patient-picker.tsx` |
| QuickRegisterForm | Mobile number (PhoneInput), Full name (`kind="name"`), Age or date of birth (AgeOrDobInput), Sex (SegmentedControl Male / Female / Other) and "Register patient" (CD-32). Checks run on blur, then live. Submitting with errors shows "Fix 4 fields before registering", focuses the first invalid field and gives each its message. A ten-digit number that matches shows the info Alert "Same mobile · Synthetic Patient 01 · last visit 3 Aug" with "Use this patient". The submit is disabled only while submitting or offline. | `components/clinical/quick-register-form.tsx` |
| Segmented control | Segments are 44 px **wide** on touch too (`touch:min-w-control`): "°F", "°C" and "PP" were 34-37 px wide at 360 and 820 (CD-03). | `lib/ui/variants.ts` |
| Gallery | The `/dev/ui` section "Clinical entry" holds: a live prescription (a repeated line, an allergy-matched line, RxEntryRow; edit opens the dose builder in a ResponsiveSheet, remove gives an Undo toast); the three line states; the vitals summary (populated, flagged, more than three, pending); the live VitalsForm; the PatientPicker on a synthetic in-memory list with a 250 ms delay; QuickRegisterForm. The data is synthetic: generic medicine names, "Synthetic Patient 0x", `900000000x`. Every submit is a no-op. | `app/dev/ui/sections/clinical-b.tsx`, `app/dev/ui/page.tsx` |
| Contrast | 8 new pairs: text on an allergy-matched line, the pills, the warning outline and icons, the flagged vital, and one informational (the Repeated outline). Report regenerated by the tool: **242 pairs, 0 fail**. | `lib/design/contrast-pairs.ts`, `evidence/06-01b/contrast.md` |

## Commits

| Commit | What |
|---|---|
| `bd68021` | Command wrapper: page-scroll confinement, `expanded`, `multiline` (the 06-02c open item) |
| `393eee6` | Segmented-control segments 44 px wide on touch (found by `clinical-b-axe` at 360/820) |
| `2629ee9` | 06-03a's wait-overflow assertion (for `f2bf3cb`), run on this plan's build |
| `c4f1e06` | `lib/clinical/{vitals,rx}.ts`, `lib/ui/focus-box.ts`, RxEntryRow + DoseBuilder, RxLineItem, VitalsForm, VitalsSummary, PatientPicker, QuickRegisterForm, the gallery section, unit specs, `keyboard/clinical-b.spec.ts`, `clinical-b-axe.spec.ts`, 8 contrast pairs, five page-wide locators in `forms.spec`/`data-and-dates.spec` scoped to their own section |
| (this commit) | Record, evidence, wave notes |

## Acceptance (plan § 06-03b "Tests that fail without the change", "UI checks", "Acceptance mapping")

| Criterion | Result | Proof |
|---|---|---|
| Tracer: RxEntryRow in the gallery with the Consult entry interaction (type → ↓/Enter → digit preset → `5d` → Enter) proven by a keystroke-count case | Met. The spec types "para" and installs a capture-phase keydown recorder on the document. Enter opens the builder for "Paracetamol 650 mg" with the usual dose ("1-0-1 · After food · 3 days"), focus in the search and `aria-expanded="false"`. "2" checks the `1-0-0` tile, "5" "d" give "1-0-0 · After food · 5 days", Enter adds. The recorded keys after the name are exactly `["Enter", "2", "5", "d", "Enter"]`. The new line's pills are named "1-0-0, morning 1, afternoon 0, night 0. Edit dose of Paracetamol 650 mg", "After food. …" and "5 days. …". The builder closes, the search is empty and focused, and the page did not move. | PR lane (`evidence/06-03b/e2e-pr.txt`) |
| `vitals.spec.ts`: unit conversions, BMI, range flags at the boundaries | Met: 79 tests. °C↔°F (37 → 98.6, 38 → 100.4, 40 → 104; a round trip for every tenth from 35.0 to 42.0 °C). BMI (78 kg / 170 cm = 27.0; null for a half-typed height or any implausible value; WHO bands at 18.5/25/30). Every flag limit and one step either side, for all nine vitals (59 cases, including fasting vs random vs PP sugar). The plausible limits accept min and max and refuse one step outside with "Enter a value between {min} and {max}". BP 1500 is an error, not a flag; text is "invalid"; empty is neither. The summary keeps the display order, shows at most three, puts a flagged value first, takes BP's worse half and gives spoken forms. Plus `rx.spec.ts` (6): spoken frequencies, `5d`/`2w`/`1m` and what is refused, clamps, the medicine ranking. | `npx vitest run tests/clinical/` 96/96 (with 06-03a's 11) |
| `clinical-b.spec.ts`: the Rx entry sequence completes in the DESIGN_SYSTEM §7.6 keystroke count | Met (tracer row). Also: ↓ then Enter picks the second match (`aria-activedescendant` follows). After the frequency digit, `2w` → 14 days (the "14 days" tile checked), `1m` → 30 (the stepper shows "1…" between), `0d` → the alert "Enter a duration from 1 to 365 days". Escape closes, empties and keeps focus. No match → the group "No medicine matches “Zinc oxide paste”" with the active option "Add “Zinc oxide paste”". The tap path works: tiles, the stepper (8 days unchecks the "7 days" tile), the instruction. Tab from the search reaches Close and then the checked frequency tile with the ring. Line edit opens the "Edit dose" sheet ("Update line" clears "Repeated"). Remove gives an Undo toast that restores the line. The allergy override is refused without a reason (`aria-invalid`) and clears with one. | PR lane |
| `clinical-b.spec.ts`: PatientPicker typeahead and Enter | Met. "0317" shows the labelled loading row ("Searching patients…"), then one row: "Synthetic Patient 03", "+91 ••••• •0317", "Last visit 28 Oct", "Add to queue". The full number is nowhere in the picker. The count "1 patient" is announced, and Enter → "Added Synthetic Patient 03 to the queue". "synth" gives 5 rows; ↓ + Enter acts on the second. The 30-character name in a row is not truncated. "9876" → the group "No patient matches “9876”" with the active "Register as new patient"; Enter → onCreate. Escape clears (`aria-expanded="false"`). The page never moved. | PR lane |
| `clinical-b.spec.ts`: VitalsForm Tab order and numeric keyboards (`inputMode`) | Met. The Tab order is Systolic, Diastolic, Pulse, Temperature, °F (one stop for the unit group), SpO₂, Resp. rate, Weight, Height, Blood sugar, Random, Save vitals. The `inputmode` values are numeric ×3, decimal (temperature), numeric ×2, decimal ×2 (weight, height), numeric (sugar). `enterkeyhint` is next ×8 then done. Enter moves to the next field. Flags appear in words: "Systolic High" / "Diastolic High"; SpO₂ 88 is "Low · critical" (danger, OctagonAlert). BMI 78/170 reads "BMI 27.0 · Overweight". °C converts 98.6 to 37 and back. Systolic 1500 blocks the save: summary "Fix 1 value before saving", focus on Systolic, `aria-invalid`, "Systolic: Enter a value between 40 and 300". Once fixed, Enter from the last field saves and posts the reading in °F with `sugarType`. Flags never blocked. | PR lane |
| Gallery axe 0 serious/critical | Met. `/dev/ui` whole page at 360/820/1180/1280: 0 serious/critical (`gallery-axe.spec`). The clinical-b section at each width, also with the medicine list open and with the dose builder open: **0 violations of any impact** in all three states at all four widths (`clinical-b-axe.spec`). | `evidence/06-03b/clinical-b-axe.json`, `e2e-pr.txt` |
| UI checks: clinical-b section at 360/820/1180/1280; axe | Met by `clinical-b-axe.spec.ts`. The checks: no horizontal scroll (also with the builder open); opening the list does not move the page; below 1024 px every control, every listbox option and every builder tile or stepper button is ≥ 44 × 44 (an input in an adorned box or the combobox box is measured by its box), and every text field draws ≥ 16 px; on a fine pointer ≥ 24 × 24; the nine vitals fields have `inputmode` numeric/decimal and an Enter-key hint. Captures were checked by eye at 360 and 1280 against V2-DX `consult-rx` and `states/consult-dose-builder`. In the full-section 360 capture the sticky "Save vitals" footer is drawn over the SpO₂ row: that is where a sticky footer sits in an element screenshot taken while scrolling, not an overlap in use. They led to the segment fix, wider vitals boxes (the unit had left a ~30 px input) and an inline allergy-match line. | `design-captures/06-03b/{gallery-clinical-b,rx-list,dose-builder}-{360,820,1180,1280}.png` (git-ignored) |
| 06-02c open item: an inline Command scrolled the page to itself; 06-03b's Rx combobox must not make the page jump (brief) | Met and proven. `/dev/ui` now loads at `scrollY` 0 with 06-02b's inline Command mounted and its first option active. Typing "a" in the Rx search gives 9 options in a 300 px list; eight ArrowDowns make the last option active and keep it inside the list's view, by scrolling the list (`scrollTop` > 0), while the page's `scrollY` stays where it was. Mutant: with cmdk's own `scrollIntoView` call restored in `scrollWithinCommandList`, the load case fails with `Received: 4758` (the 06-02c probe value). | `evidence/06-03b/mutant-command-scroll.txt`; PR lane |
| Acceptance mapping: P1-28 M2 2e (rest; InvoiceLines with V2-10, R-15) | Met (rows above). InvoiceLines is not built (R-15). | |

## Suite results (local)

| Check | Result |
|---|---|
| `npm run typecheck` | Clean (app + tests) |
| `npx eslint .` | 0 errors, 457 warnings (unchanged); 0 in the 21 files 06-03b added or changed (`evidence/06-03b/static-checks.txt`) |
| `npm run inventory` | 0 flagged |
| `node scripts/ci/ui-policy.mjs` | PASS; enforced rules 0 findings; report-mode counts unchanged (`raw-palette` 3445, `arbitrary-color` 2, `px-font` 281) |
| `npm run ci:ai-l1` | PASS (the 4 waivers are pre-existing); no "AI" copy or Sparkles in 06-03b files |
| `node scripts/design/contrast.mjs` | 242 pairs, 0 fail |
| Vitest, targeted | `tests/clinical/` 96/96 (`vitals` 79, `rx` 6, `visit-status` 11) |
| Vitest, full lane (`npx vitest run`, shared stack, at `c4f1e06`) | **279 files, 5486 passed, 18 failed, 303 skipped** (`evidence/06-03b/vitest.txt`). Every failure is outside both plans (`git diff a0e330d..c4f1e06 -- supabase features app/api lib/db lib/auth tests/security tests/integration tests/ops tests/ci tests/api tests/auth tests/setup` is empty). The shared stack moved again during the session and now carries 000079-000088 against this branch's 000078. New since 06-03a's run: `readiness-probe-db`, `auth/invite` and `membership-guard` TC-RLS-MEM-04 (42501 on invitations), `setup/teardown` FK coverage (the catalog lists 24 columns, the spec 22). The rest are as in `evidence/06-03a/vitest.txt`. Re-run after the 05b merge-in |
| `npm run e2e:pr -- --retries=0` (build of `c4f1e06`, lane lock) | **400 passed, 0 failed, 0 flaky, 128 skipped, 0 retried**: desktop-chrome 281 (06-03a: 269; +12 = 8 keyboard + 4 axe cases), pixel-7 96 (+128 skipped by design), iphone-15 18, setup 5 (`evidence/06-03b/e2e-pr.txt`, from the JSON reporter). Every M0 spec is green, and so are 06-02a's `forms.spec`, 06-02c's `data-and-dates.spec` with the scoped locators, and 06-03a's specs with the wait-overflow assertion |
| Repeat run | 06-03a + 06-03b keyboard and axe specs `--repeat-each=3 --retries=0`: **83 passed**, 0 failed (`evidence/06-03b/repeat-run.txt`) |
| gitleaks | `evidence/06-03b/gitleaks.txt` |

## Flaky-test and harness findings (this plan's own runs)

No test passed only on retry: every run used `--retries=0`. Findings from the first runs, each root-caused:

1. **The new section reuses product labels that older specs located page-wide.** "Mobile number", "Weight", "Age or
   date of birth", "Temperature unit" and "Remove Paracetamol 650 mg" now exist twice on `/dev/ui`, so
   `forms.spec`/`data-and-dates.spec` hit strict-mode violations (deterministic, not a flake). Those five locators
   are now scoped to their own section (`#forms`, `#dates`). No assertion changed.
2. **Radix RadioGroup renders hidden `<input>`s**; the vitals keypad check reads `input[data-vital]`.
3. **cmdk names its listbox from `CommandList`'s `label` prop** (default "Suggestions") and ignores `aria-label`. The
   lists are named "Medicines" and "Patients" through `label`.
4. Two mutant builds failed to type-check (an early `return` above code TypeScript then treated as unreachable). Only
   the third, type-clean mutant counts (`mutant-command-scroll.txt`).

Lane notes: twice the lane script waited for other sessions' Vitest runs on the shared stack (06:17 and 06:38 elapsed
holders) before starting e2e. Nothing was interrupted.

## Deviations

1. **Files outside the order-table row**, each needed by the plan text, the brief, the UI-SPEC or a bug:
   - `components/ui/command.tsx`: the brief puts the cmdk page-scroll fix in the Command wrapper. Also `expanded` and
     `multiline`.
   - `lib/ui/variants.ts`: segment width on touch (CD-03).
   - `lib/clinical/rx.ts` + `tests/clinical/rx.spec.ts`: the dose vocabulary and duration parser as pure, unit-tested
     functions.
   - `lib/ui/focus-box.ts`: one helper for the combobox boxes.
   - `tests/e2e/design/clinical-b-axe.spec.ts`: the plan's "UI checks" at four widths.
   - `tests/e2e/design/keyboard/{forms,data-and-dates}.spec.ts`: five locators scoped (Flaky 1).
   - `lib/design/contrast-pairs.ts` and `evidence/06-01b/contrast.md`.
2. **The dose keys are read by the search field itself**, not by a separate frequency field and Tab (DESIGN_SYSTEM
   §7.6 lists "→ Tab → timing → duration"). The UI-SPEC path is "type → ↓/Enter → digit preset → `5d` → Enter". Here
   timing keeps the doctor's usual value unless tapped or tabbed to, which gives the five-key count with no Tab.
   Every field is still reachable by Tab.
3. **No "M" Kbd hint in the Rx search.** CD-18: no single-key shortcuts in V2-06, so the hint would advertise a key
   that does nothing. V2-09 adds it with the shortcut and its on/off switch. The frequency hints 1–5 are shown (≥ lg,
   fine pointer) because those keys work.
4. **Editing a line opens the dose builder in a ResponsiveSheet** (bottom drawer below 768, side sheet above), not
   inline. The UI-SPEC asks for a Drawer on phones and does not fix the desktop form. V2-09 may inline it on the
   consult; the builder component is the same.
5. **The vitals ranges are the default adult table** (DESIGN_SYSTEM §7.3 "Assumption"). Clinic-configurable and
   paediatric ranges belong to V2-09. Pulse and resp. rate "high" start above 100 and 20 (`>= 101`, `>= 21`).
6. **QuickRegisterForm checks a mobile number as ten digits**, the same rule as PhoneInput. The 6–9 first digit is
   not enforced, because the message ("Enter a 10-digit mobile number") would not explain a refusal.
7. **The gallery's synthetic formulary** uses generic names. Its "usual dose" values are illustrations, not clinical
   advice.

## Open (owner)

- **Formulary and salt mapping** (RxEntryRow's list, the allergy match) are V2-09; the gallery list is synthetic.
- **Single-key shortcuts** (M for medicines, the consult `/` bar) with the off switch: V2-09 (CD-18).
- **Vitals ranges per clinic and by age:** V2-09.
- **PatientPicker's real search** (`searchPatientsForPalette`, four-field projection): 06-04b.
- **QuickRegisterForm on screens** (walk-in drawer, registration): V2-08 through the existing actions; the v1
  `components/patients/age-dob-input.tsx` goes then (06-02c open item).
- `scripts/ci/ui-policy-baseline.json` is not refreshed (06-08 owns it); 06-03b adds no findings.
