# Interaction counts vs v1 and the targets (tool-generated)

Desktop Chromium 1280×800 on the file:// prototypes. Each flow asserts its visible outcome; a video of every flow is in `walkthrough/`.
Counting: **taps** = clicks; **presses** = single key presses (Enter, shortcuts); **typed** = characters typed into a field. v1 per-step figures are derived from the v1 code (analysis §4); the whole-consult row also shows the M0 measurement.

## Consult (round 2)

| Step | Outcome | v2 taps | v2 presses | v2 typed | v1 taps | v1 typed | v1 path | Target | Meets |
|---|---|---|---|---|---|---|---|---|---|
| A. Add 3 complaints (durations set) | asserted | 3 | 0 | 0 | 3 | 0 | 3 quick chips, default 3 days | ≤ 3 taps, 0 typed (v1: 3 taps, 0 typed) | yes |
| B. Apply an exam template with one abnormal finding | asserted | 3 | 0 | 0 | 0 | 170 | no template; CVS/RS/PA/CNS typed (≈150) plus the finding (≈20) | ≤ 3 taps, 0 typed (v1: ≈ 170 typed characters) | yes |
| C. Add a diagnosis | asserted | 1 | 0 | 0 | 1 | 0 | quick chip (fixed list of 8 per specialty) | 1 tap, 0 typed (v1: 1 tap if in the fixed 8, else typing) | yes |
| D1. 3-drug Rx, standard dosing: your usual for the diagnosis | asserted | 1 | 0 | 0 | 6 | 27 | per drug: type ≈ 9, pick, Add (M0 measured 78 typed as custom entries) | 1 tap, 0 typed (v1: 6 taps + ≈ 27 typed) | yes |
| D2. 3-drug Rx from favourite tiles (each with the doctor's usual dose) | asserted | 3 | 0 | 0 | 6 | 27 | as D1 | 3 taps, 0 typed | yes |
| D3. 3-drug Rx by keyboard (defaults accepted) | asserted | 1 | 6 | 12 | 6 | 27 | as D1 | 0 taps after focusing the field; ≈ 4 typed per drug | yes |
| D4. Change a committed line's duration (v1: remove + re-add) | asserted | 3 | 0 | 0 | 5 | 9 | trash, confirm, retype, pick, change chip, Add | ≤ 3 taps | yes |
| Repeat last visit (diagnosis + prescription) | asserted | 1 | 0 | 0 | 1 | 0 | Repeat Last Rx (Rx only; diagnosis separate) | 1 tap (UX_AUDIT §4.2) | yes |
| E. Finish the consult (WhatsApp + front-desk billing defaulted) | asserted | 2 | 0 | 0 | 3 | 0 | Complete & Sign, untick collect, Sign (M0) | 2 taps (v1: 2, M0 measured 3) | yes |
| Whole consult A–E by tap (3 complaints, template + 1 abnormal, diagnosis, 3-drug Rx, finish) | asserted | 10 | 0 | 0 | 12 | 197 | sum of A–E in the analysis §4 | ≤ 10 taps, 0 typed (v1 code-derived: 12 taps + ≈ 197 typed; M0 measured 12 actions / 105 keystrokes with a shorter note) | yes |

## Today (unchanged from round 1, re-run on the round-2 styling)

| Flow | Outcome | Actions (M0 rules) | Actions excl. typing | Keystrokes | Mouse clicks | Target | Meets | M0 v1 actions / keystrokes |
|---|---|---|---|---|---|---|---|---|
| Check in a booked patient (filter → Enter) | asserted | 3 | 2 | 7 | 0 | 1 action + typing once the filter has focus (UX_AUDIT §4.1) | yes | not measured in M0 |
| Check in the next booked patient (filter keeps focus) | asserted | 2 | 1 | 5 | 0 | 1 action + typing | yes | not measured in M0 |
| Walk-in, existing patient → token | asserted | 4 | 3 | 13 | 0 | W → phone → Enter → Enter (3 keystrokes besides typing) | yes | 4 / 28 (walk-in-token) |
| Book, existing patient, suggested next free slot | asserted | 4 | 3 | 13 | 0 | 3 actions with context, 4 without (UX_AUDIT §5.2) | yes | 6 / 32 (book-appointment) |
| Book, existing patient, a slot of the caller's choice | asserted | 5 | 4 | 12 | 2 | 4 actions without context | yes | 6 / 32 (book-appointment) |
| Reschedule a booked appointment | asserted | 4 | 4 | 0 | 4 | ⋯ → Reschedule → slot → Confirm = 4 (UX_AUDIT §5.3) | yes | not measured in M0 |
| Collect payment for a visit in To bill | asserted | 3 | 3 | 0 | 3 | ≤ 3 (brief); UX_AUDIT §5.9 keeps 4 incl. share | yes | 9 / 22 (checkout-collect) |

Notes: M0 `checkout-collect` collected two payments (cash then UPI); the prototype flow collects one full cash payment, so that row is indicative only. M0 `consult-rx-finish` (12 actions, 105 keystrokes, 8 clicks) typed a 53-character note and two custom medicines and recorded no examination; the v1 column for the whole consult is the code-derived cost of the same five steps the v2 flow performs.

## Steps

**Check in a booked patient (filter → Enter)**: press focus Today filter → type filter (5) → press Enter = Check in

**Check in the next booked patient (filter keeps focus)**: type filter (4) → press Enter = Check in

**Walk-in, existing patient → token**: press W = walk-in → type mobile number (10) → press select top match → press Add to queue

**Book, existing patient, suggested next free slot**: press B = book → type mobile number (10) → press select patient → press Book 11:30 am

**Book, existing patient, a slot of the caller's choice**: press B = book → type mobile number (10) → press select patient → click slot 4:30 pm → click Book

**Reschedule a booked appointment**: click ⋯ → click Reschedule → click slot 12:45 pm → click Confirm

**Collect payment for a visit in To bill**: click Collect ₹700 (row) → click Collect ₹700 (sheet) → click Done

**A. Add 3 complaints (durations set)**: click tile Fever → click tile Body ache → click tile Cough

**B. Apply an exam template with one abnormal finding**: click template Fever workup (suggested) → click RS → Abnormal → click finding Crepts

**C. Add a diagnosis**: click tile Viral fever (likely from complaints)

**D1. 3-drug Rx, standard dosing: your usual for the diagnosis**: click bundle: Your usual for Viral fever

**D2. 3-drug Rx from favourite tiles (each with the doctor's usual dose)**: click favourite Paracetamol → click favourite Cetirizine → click favourite Pantoprazole

**D3. 3-drug Rx by keyboard (defaults accepted)**: click focus Medicine → type medicine (4) → press pick top match → dose builder with usual dose → press accept usual dose → type medicine (4) → press pick top match → dose builder with usual dose → press accept usual dose → type medicine (4) → press pick top match → dose builder with usual dose → press accept usual dose

**D4. Change a committed line's duration (v1: remove + re-add)**: click tap duration on the line → click 3 days → click Update line

**Repeat last visit (diagnosis + prescription)**: click Same as last visit

**E. Finish the consult (WhatsApp + front-desk billing defaulted)**: click Finish visit → click Sign and finish

**Whole consult A–E by tap (3 complaints, template + 1 abnormal, diagnosis, 3-drug Rx, finish)**: click tile Fever → click tile Body ache → click tile Cough → click template Fever workup → click RS → Abnormal → click finding Crepts → click tile Viral fever → click bundle Rx (3) → click Finish visit → click Sign and finish

