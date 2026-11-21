# V2-08 PO walkthrough (about 10 minutes, PO action 08-P3)

A script over three journeys of `docs/v2/TEST_STRATEGY.md` §7: **journey 3** (register a patient, with the duplicate warning),
**journey 4** (book an appointment, a conflicting slot is refused) and **journey 5** (walk-in to a token, the doctor opens the
consult). Use a laptop at desktop width first, then repeat steps 1 and 4 on your phone. Use only the synthetic clinic that Claude
prepared (see "Before you start"); never a real patient.

The **pass line** for each step is the interaction target: the number of taps, clicks or key presses between "I start" and "it is done".
Typing is not counted (a name, a mobile number); choosing from a list, pressing a button and pressing Enter are. Count honestly and
write the number down. A step passes when your count is at or under the target and the result is what the step says. The same
counts are measured by the automated browser tests (the `ux` files copied into the evidence folder), so a difference between yours and
theirs is itself useful to tell Claude.

## Before you start

- [ ] Claude gives you the build address and the synthetic receptionist, nurse and doctor logins (not written here).
- [ ] Two browser windows: receptionist in window 1, doctor in window 2 (a private window is fine).
- [ ] Notes open to write: what you expected, what you saw, the count.

## 1. Journey 3: register a patient (receptionist)

| Step | What to do | Pass line | Count | Result |
|---|---|---|---|---|
| 1.1 | Open **Patients**, press **Register Patient**. | The sheet opens with the cursor in the mobile number field. | | |
| 1.2 | Type a made-up mobile number, a name, an age. Choose the sex. Tick the AI choice only if you want to try it. Press **Register patient**. | Mobile, name, age, sex, Register: **5 actions** (6 with the AI box). The new patient's page opens. | | |
| 1.3 | Open **Patients > Register Patient** again, type the **same mobile number** and the **same name**. | After a short pause a **warning** says the patient is probably already registered (labelled "Smart Assist"), showing age, sex and the last four digits of the number, not the whole number. | | |
| 1.4 | Press **Use this patient**. | The existing patient's page opens. **1 action.** No second patient was created (look at the Patients list: one row). | | |
| 1.5 | Open Register Patient, type the same mobile number but a **different name** (a family member). | An information list (not the warning) shows the people on that number with age and sex, so you can tell them apart. Registering is still allowed. | | |

## 2. Journey 4: book an appointment (receptionist)

| Step | What to do | Pass line | Count | Result |
|---|---|---|---|---|
| 2.1 | Press **B** (or **+ New > Book appointment**). Type the patient's name, press **Enter**. | The patient is chosen; the doctor, the day strip and free times in the clinic's time show; a time is already chosen (the first suggestion). | | |
| 2.2 | Press **Enter** to book (the focus is already on **Book**). | Keyboard only: **B, name, Enter, Enter = 1 action and 3 key presses.** With the mouse: patient, (doctor), day, time, Book = **4 actions with the default doctor**. A toast says booked. | | |
| 2.3 | Open **Schedule**. | The patient appears at that time with the right doctor. | | |
| 2.4 | Try to book **another patient into the same time with the same doctor**. | A question appears ("that time is taken") and nothing is saved until you confirm; pressing Cancel leaves no booking. | | |
| 2.5 | Move the booking to another time: the **⋯** menu on the appointment > **Move appointment** > choose a time > **Move**. | **4 actions.** The patient's own old time was listed again as a choice; "Tell the patient" is on by default. | | |
| 2.6 | Look at the suggested times (labelled "Smart Assist") above the list. | Up to three chips: the first one is the one already chosen. They are the earliest times that are long enough for this doctor's usual consult; for a patient who usually comes in the evening, evening times come first. | | |

## 3. Journey 5: walk-in to a token to the consult (receptionist, then doctor)

| Step | What to do | Pass line | Count | Result |
|---|---|---|---|---|
| 3.1 | In window 1 press **W** (or **Walk-in**). Type an existing patient's mobile number, press **Enter**, press **Enter**. | **W, Enter, Enter = 3 key presses besides typing.** A token number appears on Today under Waiting. | | |
| 3.2 | In window 2 (doctor), open **Today**. | The patient is under **Waiting (mine)** within a few seconds **without reloading**. | | |
| 3.3 | Press **Call in** (or **Open consult**) on that row. | The consult opens. **1 action.** The row in window 1 moves to **With doctor** by itself. | | |
| 3.4 | In window 1, find a booked patient on Today and press **Check in**. | **1 action.** The row moves to Waiting. | | |
| 3.5 | Switch to a new patient: **W**, then **Register as new patient**, fill the form, press **Register and add to queue**. | Walk-in for a new patient: **2 actions plus typing** (Register as new patient, then the final button; the form's fields are counted in journey 3). One token. | | |

## 4. Two-clinic user (only if Claude gives you the login)

| Step | What to do | Pass line | Count | Result |
|---|---|---|---|---|
| 4.1 | Sign in as the two-clinic user on a fresh browser. | A page named **Choose a clinic** lists both; **1 action** opens Today for the chosen one. | | |
| 4.2 | Account menu > **Switch to <other clinic>**. | **2 actions.** The other clinic's Today opens and its patients are different. | | |

## What to tell Claude

- Any step where your count is higher than the pass line, and which extra action it was.
- Anything that felt slow (more than a second without a reaction), confusing, or that you would not trust with a real patient.
- Anything that showed more of a patient than you expected (a full phone number, an address).
- Whether the Smart Assist labels read as "help" and not as "AI".

Send the filled file back; Claude turns every miss into a fix item for the next phase or the V2-08 fix round.
