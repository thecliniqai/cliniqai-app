# V2-08 real-device checklist (the early run, PWA-10, PO action 08-P2)

Source: `docs/v2/PWA_STRATEGY.md` §9.2 (R1 to R15) and the V2-08 Today, booking and walk-in screens. This is the early run after
V2-08; the final run of all R items is V2-15. About 45 minutes. You do this by hand; Claude scores the filled file afterwards.

How to fill it: write PASS, FAIL or N/A in the Result column, and a short note for every FAIL (what you saw, what you expected, the
step number). A photo or screen recording of a failure helps; do not include a real patient's name, phone number or record in it.
Use only the synthetic clinic that Claude prepared for you (see "Before you start"); never a real patient.

## Before you start

- [ ] A staging or preview build of this branch is deployed and its address is written here: ____________________
- [ ] You have the synthetic logins for the receptionist, nurse and doctor roles (Claude gives them to you; they are not in this file).
- [ ] The devices below are charged, on the same Wi-Fi, and you know how to switch mobile data and airplane mode on and off.
- [ ] You have a second device or browser to make a change from while the first is open (needed for S4).

Devices (PWA §9.2, decision D4): **A** low-end Android phone (2-3 GB RAM, Android 12 or newer, Chrome) · **B** recent iPhone ·
**C** iPad · **D** Samsung Android tablet (also try Samsung Internet).

Which device does which check: R1 on A and D; R2 on B and C; R3 to R10 on A and B (R3 also on C and D); R13 on A (TalkBack) and B
(VoiceOver); S1 to S6 on A, B and one tablet.

## R items (PWA_STRATEGY §9.2)

| # | Check | Device(s) | Result | Notes |
|---|---|---|---|---|
| R1 | Install from Chrome Android with the in-app prompt. The icon is not cropped (maskable), the splash colour is paper, the app opens standalone on the right home for the role. Sign in inside the installed app, close it fully, reopen it: still signed in. | A, D | | |
| R2 | Install on iPhone and iPad with the instructions sheet; "Open as Web App" is on; sign in inside the app once. The session survives restarts (re-login only after more than 12 h idle or the 14-day limit). | B, C | | |
| R3 | The status bar and home indicator do not overlap the top bar, bottom bar, sheet buttons or toasts, in portrait and landscape. Look at Today, the walk-in sheet and the booking sheet. | A, B, C, D | | |
| R4 | The keyboard does not cover the field you type in or the main button in Register patient, the vitals sheet, and the payment fields. The right keypad appears (numbers for mobile and age). The page does not zoom when a field is focused. | A, B | | |
| R5 | Back works on every screen that is not a home screen (iOS has no swipe-back). There is no sheet you cannot leave. | A, B | | |
| R6 | Airplane mode: the offline banner and page appear. Switch it off: the app recovers without a reload. Leave the app in the background for 10 minutes, return: Today refreshes by itself. | A, B | | |
| R7 | Walk-in, booking and payment on a flaky network: toggle mobile data in the middle of pressing the main button. No duplicate (one patient, one visit, one payment), and Retry works. | A, B | | |
| R8 | Open a lab PDF and a prescription PDF; print or share to WhatsApp; take a photo for a lab upload. | A, B | | |
| R9 | Sign out, and Switch user, then reopen the app: Back shows no patient data. (Android) With Chrome remote debugging, Application > Cache Storage holds only the allowed caches. | A, B | | |
| R10 | Update: with the app open, Claude deploys a newer build. The update toast appears; reload at a safe moment; you never see "Failed to find Server Action". | A, B | | |
| R11 | **Not built yet; final run V2-15.** (Signup and password-reset codes, and invite links, inside the installed iOS app.) | | N/A | |
| R12 | **Not built yet; final run V2-15.** (Subscription AutoPay set-up and return.) | | N/A | |
| R13 | Screen-reader smoke test of the shell and Today: TalkBack on A, VoiceOver on B. Cover the navigation, a Today row, and the walk-in sheet. (S6 is the detailed list.) | A, B | | |
| R14 | **Not built yet; final run V2-15.** (Idle local sign-out after 10 minutes and the app-switcher snapshot.) | | N/A | |
| R15 | **Not built yet; final run V2-15.** (Data export download on a locked clinic.) | | N/A | |

## S items (V2-08 front desk)

| # | Check | Device(s) | Result | Notes |
|---|---|---|---|---|
| S1 | **Today on a phone and a tablet.** Phone: one lane at a time (switch Waiting, With doctor, To bill, Done); tapping a row opens its detail from the bottom. Tablet (iPad, Samsung): two panes, list on the left and the selected patient on the right; each pane scrolls on its own; nothing is cut off at the bottom in portrait or landscape; the offline banner does not hide a sheet's Save button. | A, B, C, D | | |
| S2 | **Walk-in on a flaky network.** Open Walk-in, find a patient by mobile, press the main button; switch mobile data off and on during the press. Expected: one token only (check Today afterwards), a clear "Couldn't save · Retry" or a saved state, never a second token. Repeat with a new patient (Register as new patient inside the sheet). | A, B | | |
| S3 | **Booking in the installed app.** Open the app from the home screen icon (not the browser). Book an appointment for an existing patient and then for a new one: the day strip, the free times in the clinic's time (not the phone's), the suggested times chips, Book. The booked patient appears on Schedule. Check the date and time shown match what you picked. | A, B, C, D | | |
| S4 | **Realtime: live, and after 10 minutes in the background.** Keep Today open. From the second device check a patient in: the row moves within a few seconds, with no reload. Put the app in the background for 10 minutes, change something from the second device, return: Today shows the change within a few seconds (the "Live" or "Updating every 20 s" label is fine). | A, B, one tablet | | |
| S5 | **Keyboard over QuickRegister.** Open Register patient (or Walk-in > Register as new patient). Tap each field in turn: the field, its error message and the Register button stay visible above the keyboard; the mobile and age fields open the number keypad; the Smart Assist duplicate warning, when you type a mobile that exists, is readable and "Use this patient" can be tapped. | A, B | | |
| S6 | **TalkBack and VoiceOver on Today.** The page has a heading; each lane is announced with its count; each row reads name, status and wait time; the action buttons have names (Check in, Start consultation); a new arrival is announced politely without stealing focus; the walk-in and booking sheets announce their title and put focus inside. Note any control that is read only as "button". | A (TalkBack), B (VoiceOver) | | |

## Clinic switcher (only if the synthetic user belongs to two clinics)

| # | Check | Device(s) | Result | Notes |
|---|---|---|---|---|
| S7 | Sign in as the two-clinic user. A "Choose a clinic" page lists both clinics; picking one opens Today for it. In the account menu, "Switch to <other clinic>" opens the other clinic's Today and the patient list is different. | A, B | | |

## Sign-off

- Run date: ____________  Run by: ____________  Build address: ____________________
- Devices actually used (model, OS version, browser): ______________________________________________
- Number of FAIL results: ____  The ones that block the V2-08 release: ______________________
- Send this file back to Claude; Claude scores it and opens a fix list for every FAIL.
