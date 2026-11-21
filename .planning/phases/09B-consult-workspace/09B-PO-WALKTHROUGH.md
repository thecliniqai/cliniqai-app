# V2-09b PO walkthrough: the consult workspace (about 10 minutes)

For the product owner (PO-ACTIONS `09B-P2`). Use a **local or staging** clinic with **synthetic patients only**: never a real patient. Sign in as the **doctor**. Have a second browser (or a private window) signed in as the same doctor for step 4, and the receptionist for step 8 if you want to see the front-desk leg.

Before you start: Settings is not needed. Smart Assist keys (`assist.*`) are on for the standard plan. If a step says "you see X" and you do not, write down which step and what you saw instead.

## 1. Open the consult from Today (1 min)

1. Open **Today**, switch to **My queue** (doctor mode).
2. Find a waiting synthetic patient and press **Call in**. The consult opens.
3. You see: the allergy strip under the top bar (it stays on screen when you scroll), the five sections (Complaints, Examination, Diagnosis, Prescription, Plan), and **Saved** or a quiet status in the top bar.
4. Press **Alt+3**: focus jumps to the Diagnosis heading. **Alt+1** brings you back. (On a tablet or a laptop with a keyboard.)

## 2. Tap entry: no typing (2 min)

1. In **Complaints**, tap **Fever** and **Cough**. Each gets a duration (3d by default); tap another duration pill (for example **5d**) on Cough.
2. In **Examination**, tap the **Respiratory** template. Every system reads as normal. Set **RS** to **Abnormal**, tap the finding **Crepts**, and choose the side **Right**.
3. In **Diagnosis**, if you have signed visits of your own with the same complaint, a "Likely from the complaints" group (marked **Smart Assist**) offers your usual diagnosis: tap it once. Otherwise tap a specialty chip such as **Viral Fever**.
4. In **Plan**, tap two investigation tiles and one advice tile, then a follow-up interval (**1 week**). The line under it names the date and the weekday.
5. Wait about 5 seconds: the top bar shows **Saving...** then **Saved**.

What to judge: did you need the keyboard at all? Was anything inserted that you did not tap?

## 3. Shorthand (2 min)

1. In the note, press **Shorthand** (or press `/` when no field is focused, if the single-key shortcuts switch is on).
2. Type exactly: `c/o fever 3d, cough 2d; adv steam inhalation BD; f/u 5d`
3. The preview lists **Complaints** (Fever 3 days, Cough 2 days), **Advice** (steam inhalation twice daily) and **Follow-up** (5 days, with the date). Nothing is in the note yet.
4. Press **Enter**. The three parts land in their sections in one change. (Press **Escape** instead and nothing is inserted.)
5. Press **Shorthand**, then **Macros**: add a macro `.ur` that expands to `adv rest, plenty of fluids`. Close, open **Shorthand**, type `.u`, tap the suggested macro, and see the preview.

What to judge: is every word in the preview something you typed? (The tool never adds a dose, a duration or a diagnosis you did not write.)

## 4. Two tabs, one consult (2 min)

1. Open the same consult in the second window.
2. In window A, change the **notes** text. In window B, add an **advice** tile. Wait for **Saved** in both. Different fields merge: no prompt.
3. Now type different text into the **same notes field** in both windows and wait for **Saved** in B, then in A. One window shows **"This consultation was changed in another tab or device"** and asks you to **Use the other version** or **Keep mine**. Try both on a second pass.

## 5. Kill the app mid-note (1 min)

1. In the note, type a sentence, wait for **Saved**, then type a few more words and **close the tab immediately** (or force-quit the installed app).
2. Reopen the consult. Everything up to the last **Saved** is there. At most the last 5 seconds of typing is lost. Nothing is kept on the device itself: sign out and look at the browser storage if you want to check (it holds no consult text).

## 6. Upload a report (1 min)

1. In **Plan**, **Clinical attachments**, choose a small PDF or a photo (not larger than 25 MB). A row shows **Uploading...**, then **Stored**. It appears in the **Attachments** list and, on a wide screen, under **Documents** in the patient column.
2. Try a **.exe** or a very large file: it is refused at once with a plain message and nothing is sent.
3. Press **Open** on the report: it opens in a new tab through a short-lived link.

## 7. Finish, then amend (2 min)

1. Add two medicines in **Prescription** (the existing builder), then press **Finish visit**. In the sheet press **Sign & Route to Reception**.
2. The record is sealed: you cannot edit it, no upload area is shown, the Attachments list stays, and **Amend** is offered.
3. Press **Amend**, give a reason of at least 10 characters, confirm, change something, and press **Finalize amendment**. The record is sealed again at version 2.

## 8. Front desk: Book follow-up (optional, 1 min)

As the receptionist on **Today**, a completed visit with a recommended follow-up shows **Book follow-up**. It opens the booking sheet with the patient, the doctor and the date filled in; you confirm the slot. After booking, the button is gone.

## What to report

For each step: works / works but awkward / broken, plus anything that made you stop. The device-specific items (low-end phone, tablet, screen readers) are in `09B-DEVICE-CHECKLIST.md`.
