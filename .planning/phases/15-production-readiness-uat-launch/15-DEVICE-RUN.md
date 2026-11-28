# V2-15 final real-device run kit (PWA-10, R1 to R15)

Source: `docs/v2/PWA_STRATEGY.md` section 9.2 (R1 to R15), the V2-08 early run (`.planning/phases/08-front-desk/08-DEVICE-CHECKLIST.md`),
and roadmap section 17.1 "Real-device checklist R1-R15 passed on 4 devices (incl. one low-end Android) and scored by an
isolated reviewer agent". This is the **final** run: R11, R12, R14 and R15, which did not exist at V2-08, now run for
real. About 90 minutes on four devices. You do it by hand; an isolated Claude reviewer agent scores your filled file,
notes and screenshots afterwards.

## How to fill it

Write PASS, FAIL or N/A in the Result column of the table; for every FAIL add a note (what you saw, what you expected,
the step number). Attach a photo or screen recording to each FAIL. **No real patient name, phone number, e-mail address,
code or password in any note or screenshot.** Crop or hide before saving. Save screenshots in a private folder and give
the folder path to Claude when asked (do not commit them).

## Before you start

- [ ] Build under test: the **production** URL (or a preview build with production-like settings) written here: ________
- [ ] Synthetic or PO-owned test clinic with owner, doctor, receptionist and nurse logins you control (not in this file).
- [ ] A `uat` code for one extra test clinic (R12) and a UPI app plus a card for the AutoPay test (live mode: the Rs 5
      authorisation is refunded automatically; see `docs/runbooks/razorpay-live.md` section 4).
- [ ] A second device or browser to make changes from while the first is open.
- [ ] Devices charged, on Wi-Fi, mobile data and airplane mode known.
- [ ] Gmail and WhatsApp installed on the phones (R11 invite link from their in-app browsers).

Devices (PWA decision D4): **A** low-end Android phone (2 to 3 GB RAM, Android 12 or newer, Chrome) | **B** recent iPhone |
**C** iPad | **D** Samsung Android tablet (also Samsung Internet).

Which device does which check: R1 on A and D; R2 on B and C; R3 to R10 on A and B (R3 also on C and D); R11 on B and A;
R12 on A and B; R13 on A (TalkBack) and B (VoiceOver); R14 on A and B; R15 on A and B.

## R items

| # | Steps | Expected | Device(s) | Result | Notes |
|---|---|---|---|---|---|
| R1 | Chrome on Android: use the in-app install prompt. Look at the icon and splash. Open the app. Sign in inside the installed app, close it fully (swipe away), reopen. | Icon not cropped (maskable); splash colour is paper; opens standalone on the home screen for the role; still signed in after reopening. | A, D | | |
| R2 | iPhone and iPad: follow the instructions sheet to Add to Home Screen; "Open as Web App" on; sign in once inside the app; close and reopen. | Session survives restarts; re-login needed only after more than 12 h idle or the 14-day limit. | B, C | | |
| R3 | In portrait and landscape open Today, the walk-in sheet and the booking sheet. | Status bar and home indicator never overlap the top bar, bottom bar, sheet buttons or toasts. | A, B, C, D | | |
| R4 | Register patient, vitals, password field and a payment field: tap each. | Keyboard never covers the field or the main button; right keypad (numbers for mobile and age); no zoom on focus. | A, B | | |
| R5 | Press Back (Android) or use the on-screen Back (iOS) on every non-home screen you visit. | Back always works; no sheet you cannot leave. | A, B | | |
| R6 | Switch on Airplane mode, look at the page, switch it off. Put the app in the background for 10 minutes and return. | Offline banner and page show; app recovers without a reload; Today refreshes by itself. | A, B | | |
| R7 | Walk-in, booking and payment: switch mobile data off and on in the middle of pressing the main button. | One patient, one visit, one payment (no duplicates); Retry works. | A, B | | |
| R8 | Open a lab PDF and a prescription PDF; share to WhatsApp; take a photo for a lab upload. | Each opens, shares and uploads. | A, B | | |
| R9 | Sign out; then Switch user; reopen the app; press Back. On Android with Chrome remote debugging, open Application > Cache Storage. | Back shows no patient data; only the allowed caches exist. | A, B | | |
| R10 | With the app open, Claude deploys a newer build (ask Claude to deploy a harmless change). | The update toast appears; reload at a safe moment; you never see "Failed to find Server Action". | A, B | | |
| R11 | **iOS installed app:** sign up a throwaway owner with a code and finish the e-mail code inside the installed app; do forgot-password and finish the code inside the app. Then open a staff invite link from the **Gmail** app and from **WhatsApp**, on Android and iOS; set a password; sign in inside the installed app. | Codes complete inside the app; invite links complete set-password; sign-in inside the app works. | B, A | | |
| R12 | In the installed app (Android, then iOS) start AutoPay for a test clinic with a `uat` code (UPI app, then card where practical). On iOS, if the app reloads when you return from the UPI app, note it. | Mandate completes and returns to the app. After a reload on return, the billing page says "Confirming your AutoPay" and **never** shows "Start trial" again. | A, B | | |
| R13 | TalkBack on A, VoiceOver on B: go through the navigation, one Today row and the walk-in sheet. | Headings, lane counts, row name, status and wait are announced; the sheet's fields have labels; no trap. | A, B | | |
| R14 | Sign in on a clinical screen; do not touch the device for 10 minutes. Then switch to the app switcher before and after. | The app signs out locally and lands on `/login` with the e-mail prefilled; the app-switcher snapshot shows no patient data before or after sign-out. | A, B | | |
| R15 | As owner of a clinic whose subscription is **expired** (ask Claude for the test state or use a clinic with an expired trial), open Settings > Data export and download the ZIP inside the installed app. | The download starts and the file can be opened or saved on Android and iOS. | A, B | | |

## Extra checks for production (from the V2-08 run)

| # | Check | Result | Notes |
|---|---|---|---|
| X1 | Install > sign in > close > reopen: still signed in (row "install, sign in, reopen") | | |
| X2 | Open `/help` at phone width: contact and feedback links work | | |
| X3 | Open the Terms, Privacy, Refund and Cancellation, Pricing and Contact pages from the footer | | |
| X4 | `/.well-known/security.txt` loads and the contact is not "REPLACE-ME" | | |

## After the run

1. Tell Claude the folder path of the notes and screenshots. An **isolated reviewer agent** (fresh context) scores each
   item from your file and screenshots only and writes `15-DEVICE-RUN-SCORE.md` with PASS or FAIL per item and a list of
   defects with severity.
2. Zero open P1 PWA defects are needed for G6 (PWA_STRATEGY section 10). Anything else goes to release notes "Known gaps".
3. Delete the screenshots after the review if they contain any real data.

```
devices used: A <model, Android version>, B <model, iOS version>, C <model>, D <model>
build under test: <url or version>
date: <date>
```
