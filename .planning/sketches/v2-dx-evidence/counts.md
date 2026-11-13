# Interaction counts vs M0 and the UX_AUDIT §4/§5 targets (tool-generated)

Desktop Chromium 1280×800 on the file:// prototypes. Each flow asserts its visible outcome; a video of every flow is in `walkthrough/`.
Counting: click, key press and each typed field = 1 action (the M0 rules in `tests/e2e/support/ux-counter.ts`); *excluding typing* = clicks + key presses (UX_AUDIT §5 counts "a click, tap or Enter; typing is not counted").

| Flow | Outcome | Actions (M0 rules) | Actions excl. typing | Keystrokes | Mouse clicks | Target | Meets | M0 v1 actions / keystrokes |
|---|---|---|---|---|---|---|---|---|
| Check in a booked patient (filter → Enter) | asserted | 3 | 2 | 7 | 0 | 1 action + typing once the filter has focus (UX_AUDIT §4.1) | yes | not measured in M0 |
| Check in the next booked patient (filter keeps focus) | asserted | 2 | 1 | 5 | 0 | 1 action + typing | yes | not measured in M0 |
| Walk-in, existing patient → token | asserted | 4 | 3 | 13 | 0 | W → phone → Enter → Enter (3 keystrokes besides typing) | yes | 4 / 28 (walk-in-token) |
| Book, existing patient, suggested next free slot | asserted | 4 | 3 | 13 | 0 | 3 actions with context, 4 without (UX_AUDIT §5.2) | yes | 6 / 32 (book-appointment) |
| Book, existing patient, a slot of the caller's choice | asserted | 5 | 4 | 12 | 2 | 4 actions without context | yes | 6 / 32 (book-appointment) |
| Reschedule a booked appointment | asserted | 4 | 4 | 0 | 4 | ⋯ → Reschedule → slot → Confirm = 4 (UX_AUDIT §5.3) | yes | not measured in M0 |
| Collect payment for a visit in To bill | asserted | 3 | 3 | 0 | 3 | ≤ 3 (brief); UX_AUDIT §5.9 keeps 4 incl. share | yes | 9 / 22 (checkout-collect) |
| Consult: note, diagnosis, 2 medicines by keyboard, sign | asserted | 18 | 12 | 58 | 3 | 0 mouse actions per medicine (UX_AUDIT §4.2) | yes | 12 / 105 (consult-rx-finish) |
| Consult: repeat last prescription | asserted | 1 | 1 | 0 | 1 | 1 action (UX_AUDIT §4.2) | yes | not measured in M0 |

Notes: M0 `checkout-collect` collected two payments (cash then UPI); the prototype flow collects one full cash payment, so that row is indicative only. M0 `consult-rx-finish` typed more free text (105 keystrokes); compare actions, not keystrokes.

## Steps

**Check in a booked patient (filter → Enter)**: press focus Today filter → type filter (5) → press Enter = Check in

**Check in the next booked patient (filter keeps focus)**: type filter (4) → press Enter = Check in

**Walk-in, existing patient → token**: press W = walk-in → type mobile number (10) → press select top match → press Add to queue

**Book, existing patient, suggested next free slot**: press B = book → type mobile number (10) → press select patient → press Book 11:30 am

**Book, existing patient, a slot of the caller's choice**: press B = book → type mobile number (10) → press select patient → click slot 4:30 pm → click Book

**Reschedule a booked appointment**: click ⋯ → click Reschedule → click slot 12:45 pm → click Confirm

**Collect payment for a visit in To bill**: click Collect ₹700 (row) → click Collect ₹700 (sheet) → click Done

**Consult: note, diagnosis, 2 medicines by keyboard, sign**: click Notes → type notes (31) → press Alt+3 diagnosis → type diagnosis (3) → press pick Essential hypertension → press Alt+4 prescription → type medicine (5) → press pick Telmisartan → press preset 2 = 1-0-0 → type duration (3) → press add line → type medicine (4) → press pick Amlodipine → press preset 3 = 0-0-1 → type duration (3) → press add line → click Finish visit → click Sign and finish

**Consult: repeat last prescription**: click Repeat last Rx

