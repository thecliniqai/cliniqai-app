# V2-09b device checklist: the consult on a low-end Android phone and a tablet (about 20 minutes)

For the product owner (PO-ACTIONS `09B-P2`, with `09B-PO-WALKTHROUGH.md`). Use the **installed app (PWA)** on each device where you can, signed in as a doctor on a **staging or local** clinic with **synthetic patients only**. Note the device model, the OS version and the browser for each run.

Devices: (A) a low-end Android phone (2 to 3 GB RAM, Chrome), (B) a tablet (an iPad or an Android tablet), (C) one phone or tablet with a screen reader on (TalkBack on Android, VoiceOver on iPhone or iPad).

Mark each line **OK**, **Awkward** (works, but a doctor would complain) or **Broken**, and add one line of what you saw.

## A. Low-end Android phone (360 to 412 px wide)

| # | Check | Result |
|---|---|---|
| A1 | Open a consult from Today. The allergy strip is under the top bar and stays visible while you scroll to Plan. | |
| A2 | The section strip (Complaints, Exam, Diagnosis, Rx, Plan) follows your scroll and a tap jumps to the section. The Finish bar is fixed at the bottom with **Patient** and **Finish visit**. | |
| A3 | Tap three complaint tiles and a duration pill: each tap responds at once, no lag. | |
| A4 | Type a sentence in the note. **The keyboard over the note**: the cursor stays visible above the keyboard, the Finish bar does not cover the text, and the page does not jump. | |
| A5 | Wait for **Saved**. Type a few more words, then **kill the installed app** (swipe it away from recents). Reopen it and the consult: everything up to the last **Saved** is there. | |
| A6 | Turn on airplane mode, type a few words: the top bar shows **Offline · not saved**. Turn it off: it saves within a few seconds and shows **Saved**. | |
| A7 | **Patient** (Finish bar): the Patient sheet opens from the bottom with vitals, allergies, problems, snapshot and history. It closes with the close button and by swiping the back gesture or pressing Back, and focus returns to the button. | |
| A8 | **Shorthand** button: the sheet opens, the keyboard appears, type `c/o fever 3d; adv rest BD; f/u 5d`, the preview shows three groups, **Insert** adds them. | |
| A9 | **Upload from the file picker**: in Plan, **Upload lab report or radiograph** opens the system picker; pick a photo from the gallery and a PDF from Files. Each row shows **Uploading...** then **Stored**; a photo of several MB works. | |
| A10 | **Finish visit** opens the Sign & Bill sheet from the bottom; **Sign & Route to Reception** completes it; the sealed record shows the Attachments list and no upload area. | |

## B. Tablet (portrait and landscape)

| # | Check | Result |
|---|---|---|
| B1 | Portrait about 744 to 820 px: the note is one wide column; the top bar has **Patient**, **Save Draft** and **Finish visit**; **Patient** opens a right-hand sheet. | |
| B2 | Landscape about 1180 px and wider: the patient column is always on the left with the snapshot, vitals grid and Documents. | |
| B3 | At 1280 px and wider the **Summary** button toggles the "as the patient will see it" pane; it is open by default from 1440 px. | |
| B4 | With a hardware keyboard: **Alt+1 to Alt+5** move between sections; `/` opens the shorthand bar when the single-key switch is on (press `?` for the list). | |
| B5 | **Kill the installed app mid-note** and reopen it (same as A5). | |
| B6 | Two devices, one consult (a phone and the tablet, same doctor): a change to different fields merges; the same field in both shows the conflict choice. | |

## C. Screen readers (TalkBack and VoiceOver)

| # | Check | Result |
|---|---|---|
| C1 | Swipe through the consult: the allergy strip is announced first and clearly (it says whether allergies are known, none, or not recorded). | |
| C2 | Each section is a heading (Complaints, Examination, Diagnosis, Prescription, Plan) and the headings can be jumped to. | |
| C3 | A complaint tile says its name and whether it is selected; duration pills say "for 3d" style names with the complaint; removing says what is removed. | |
| C4 | The shorthand bar: the field is named, the preview region reads out the groups when it changes, **Insert** is announced and the sheet closes with focus back on the **Shorthand** button. | |
| C5 | The upload control: the button is named **Upload lab report or radiograph** and its limits are read; each file row reads its status (Uploading, Stored, Failed) and a failed row has **Retry**. | |
| C6 | The **Saved**, **Saving...** and failure states are announced without stealing focus. | |
| C7 | The conflict choice and the Sign & Bill sheet trap focus, name themselves, and close with Escape or the close button, returning focus to where you were. | |

## Send back

The three tables, the device and OS details, and any screenshot (synthetic data only). Anything marked **Broken** blocks the phase's gate; **Awkward** goes to the backlog with an owner.
