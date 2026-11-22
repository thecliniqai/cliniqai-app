# V2-09c PO walkthrough: the Rx builder, the PDF and the finish (about 10 minutes plus the printer step)

For the product owner (PO-ACTIONS `09C-P2`). Use a **local or staging** clinic with **synthetic patients only**: never a real patient. Sign in as the **doctor**. The medicine catalogue on a local stack is nearly empty, so a typed medicine that is not found is added with the **Add "name"** row at the bottom of the list: that is expected. On staging the CDCI catalogue is loaded; until `09C-P4` (the CDCI reload with substance ids) has run, CDCI medicines are checked against allergies **by name only**, and the line says so.

If a step says "you see X" and you do not, write down which step and what you saw instead. Steps 1 to 3 are the keyboard; you can do them with the mouse parked.

## 1. Three medicines with the keyboard only (2 min)

1. Open a consult from **Today** (**Call in**). Press **Alt+4**: the Prescription section heading has the focus. Press **M**: the cursor is in the medicine field. (If **M** types an "m" instead, switch the single-key shortcuts on with **?**.)
2. Type a medicine name (for example `Paracetamol`). Use **Down** to walk to the row you want, press **Enter**. A dose builder opens with **nothing filled in**: there is no default dose any more.
3. Press **Enter** now: it adds nothing and says **"Choose a frequency (1 to 5) and a duration such as 5d"**. That is the point: the tool never invents a dose.
4. Press **1** (1-0-1), type **5d**, press **Enter**. The line is on the list and the cursor is back in the field.
5. Add two more medicines the same way, with a different key each time (**2** is 1-0-0, **3** is 0-0-1).
6. Edit a line: Tab to a line's dose pill, **Enter**, change the duration, **Enter**. Remove a line: its remove button shows an **Undo** for 8 seconds; press Undo and the line is back with the same dose.

What to judge: could you write the three lines without touching the mouse? Was anything on a line that you did not choose?

## 2. An allergy match, with a reason (2 min)

1. In the allergy strip press **Record now** (or **Edit**). In the sheet type `Penicillin`; pick a listed substance if one appears, or keep the free text. Save.
2. In the Prescription section search for a penicillin medicine (a catalogue brand, or type `Penicillin V` and add it as a custom medicine). The result shows an **Allergy** chip; in the dose builder you see **"Matches allergy: Penicillin"** and **Enter** does not add it.
3. Press the **Prescribe anyway…** button, type a reason of at least 5 characters (for example `Tolerated before, patient informed`), and send. The line is added with **"Prescribed despite allergy: …"** under it.
4. Press **Finish visit** (step 6) with an unresolved match on the list and see that **Sign is disabled** until every match has a reason or is removed. **Go to {medicine}** returns you to that line.

What to judge: is the warning clear before you add, and is the reason one tap away when you mean it? A patient whose allergies were never asked shows **"Allergies not recorded · Record now"**, which is different from **"No known allergies"**.

## 3. Your usual, favourites and Same as last visit (2 min)

(These use your own signed history; with a new doctor sign a few synthetic visits first, or use the `seed:local` doctor.)

1. With a diagnosis you have treated before on the visit, the Prescription section offers **"Your usual for {diagnosis}"**: one tap adds the whole set with your **stored** doses. Lines added this way carry a **Repeated** marker until you touch them.
2. Favourite tiles under it add one medicine each with your usual dose; a favourite you have never given a full dose for opens the dose builder instead of guessing.
3. For a patient you saw before, **"Same as last visit · {date}"** copies the last signed visit's diagnosis and medicines in one tap. A medicine that matches the patient's allergy is **not** copied: its dose builder opens flagged instead.
4. Every tile is marked **Smart Assist** and adds nothing until you tap it.

## 4. The printed prescription: A5 on pre-printed paper (printer step, 5 min)

1. As the **owner**: **Settings, Clinic, Prescription printing**. Choose **A5**, **Pre-printed letterhead**, set the top and bottom margins in millimetres to match your stationery (for example 40 and 20), **Save printing settings**. The paper and letterhead apply to prescriptions you start **after** this; the margins to every print.
2. As the doctor, write a prescription with at least two medicines for a new synthetic patient and sign it (step 6).
3. On the signed record press **Print Rx**. The browser's print dialog shows only the prescription. Choose your printer, set **Paper size A5**, **Margins: Default** (or None), switch **Headers and footers off** (the browser's own date and address lines print inside your margins otherwise), and print on a real pre-printed A5 sheet.
4. Check the letterhead area is untouched, the text starts below it, and nothing runs into the footer area. Also open **Rx PDF** and **PDF on blank paper** (the other kind of paper, made on the spot and not stored) to see the same words.

What to judge: does the Rx fit the stationery with the margins you set? A medicine with no timing prints no timing (it does not say "After food" any more).

## 5. Finish in two taps (1 min)

1. Press **Finish visit**. The sheet opens on the **review**: what the patient receives (complaints, findings, diagnosis, medicines, tests, advice, the follow-up date), any allergy match that still needs a reason, the **WhatsApp checkbox** and the line "Signing locks this prescription. Changes after signing are amendments with a reason."
2. The **WhatsApp checkbox is not ticked**: nothing is sent unless you tick it. Leave it unticked for this run.
3. Press **Sign & Route to Reception** (or **Sign & Collect** for an owner). The success screen offers **WhatsApp** (send the Rx link now), **Share PDF**, **Print Rx** and the receipt buttons.

## 6. WhatsApp, only when you choose (1 min)

1. Repeat step 5 on another synthetic patient **with a phone number you control** (staging only) and **tick** "Send the prescription and receipt on WhatsApp". After signing, one message is queued with both links (a replayed sign does not send twice).
2. A patient who has asked not to be messaged, or has no phone number, has the box disabled with the reason.

## 7. Share the PDF from a phone (1 min, a real phone)

1. On a phone, open the signed record and tap **Share PDF**. The phone's share sheet opens with a file named like `Prescription-2026-11-22-v1.pdf` (the visit date and the version; **no patient name**). Choose WhatsApp or Mail and send it to yourself.
2. On a device that cannot share files, the button reads **Download PDF** and saves the same file.
3. Open the file: it is the signed prescription, the same bytes the clinic archived.

## 8. A photo of a report (1 min, a real phone)

1. In **Plan**, **Clinical attachments**, a **Take photo** button sits beside the upload area on a phone or tablet. Tap it, take a photo of a (synthetic) report.
2. The row shows **Uploading…** then **Stored**, and the size shown is at most about 1 MB even for a 5 to 12 MB camera photo. Open it from the list: the picture is upright and readable.
3. Choose a photo from the gallery with the normal upload button: the same thing happens. A PDF goes up as it is.

## Send back

Anything that surprised you, with the step number. Items to confirm for `09C-P5`: **Q-1** (one archived PDF per signed version), **Q-2** (a print stylesheet on the signed Rx plus the PDF), **Q-6** (new patients show "Allergies not recorded"), **Q-8** (WhatsApp is never ticked for the doctor; the existing automatic message on every sign is now the doctor's choice), **Q-9** (the printed product line stays, with the page and version line added).
