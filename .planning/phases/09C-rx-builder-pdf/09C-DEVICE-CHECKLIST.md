# V2-09c device checklist: the Rx, print, share and camera on a low-end Android phone and an iPad (about 30 minutes)

For the product owner (PO-ACTIONS `09C-P2`, with `09C-PO-WALKTHROUGH.md`). Use the **installed app (PWA)** on each device where you can, signed in as a doctor on a **staging or local** clinic with **synthetic patients only**. Note the device model, the OS version and the browser for each run.

Devices: (A) a low-end Android phone (2 to 3 GB RAM, Chrome), (B) an iPad (Safari, installed to the home screen), (C) one phone or tablet with a screen reader on (TalkBack on Android, VoiceOver on iPhone or iPad), (D) a **real printer** with A5 pre-printed stationery (and A4 plain paper) reachable from a laptop or from the share sheet.

Mark each line **OK**, **Awkward** (works, but a doctor would complain) or **Broken**, and add one line of what you saw.

## A. Low-end Android phone (360 to 412 px wide)

| # | Check | Result |
|---|---|---|
| A1 | Prescription section: the medicine field, the result list and the dose builder fit the width with no sideways scroll. Tap a result, tap a frequency tile and a duration tile, tap **Add to prescription**: each tap responds at once. | |
| A2 | **The keyboard over the Rx field**: with the on-screen keyboard open the field, the result list and the dose builder stay visible above it, the Finish bar does not cover them, and the page does not jump. | |
| A3 | **Take photo** is shown beside the upload area. Tap it: the **camera** opens (rear camera). Take a photo of a synthetic report: the row goes **Uploading…**, **Stored**; the size shown is at most about 1 MB. Open the file from the list: it is the right way up and readable. | |
| A4 | **Choose a photo from the gallery** with the upload button (a 5 to 12 MB photo): the same result as A3. Choose a PDF: it is stored as it is. | |
| A5 | Photo location: take a photo with location tagging on in the camera settings, upload it, download it from the list on a laptop and check its properties: **no GPS coordinates or camera details** in the file. | |
| A6 | Finish visit: the review sheet opens from the bottom; the summary, the lock line and the WhatsApp checkbox (**unticked**) are readable; **Sign & Route to Reception** completes it. | |
| A7 | **Share PDF** on the success screen and on the signed record: the **Android share sheet** opens with a PDF named `Prescription-{date}-v{n}.pdf` (no patient name). Send it to WhatsApp (to a test number) and to Drive: the PDF opens and is the signed prescription. | |
| A8 | **Print Rx** on the signed record: the print preview shows only the prescription. Print to PDF or a connected printer through the system print service. | |
| A9 | Leave the app, switch back: nothing from the prescription is kept in the app's storage (sign out and check the browser's site storage: no PDF, no prescription text). | |

## B. iPad (portrait and landscape, Safari and the installed app)

| # | Check | Result |
|---|---|---|
| B1 | The Rx section and the review at about 744 to 820 px (portrait) and 1180 px (landscape): nothing is cut off, the review opens as a right-hand sheet, the touch targets are easy to hit. | |
| B2 | **Take photo** is shown (an iPad has a coarse pointer). Tap it: the camera opens. Take a photo, upload: stored under about 1 MB. Also choose an **iPhone-library photo** (HEIC) with the upload button: it is stored as a JPEG, or refused with the plain message "This photo could not be compressed. Try a smaller photo or a PDF." (a HEIC file that Safari cannot read; note which). | |
| B3 | **Share PDF** opens the iPadOS **share sheet** straight from the tap (no second tap needed). Choose **Print**: the system print preview shows the prescription. Choose **Save to Files** and **AirDrop** (to another device): the file is the prescription PDF. | |
| B4 | **Print Rx** (the browser's print dialog): the preview shows only the prescription at the paper size you set in **Settings, Clinic, Prescription printing**. | |
| B5 | With a hardware keyboard: **Alt+4**, **M**, a medicine name, **Down**, **Enter**, **1**, **5d**, **Enter** adds a line; Tab and Enter edit a line. | |
| B6 | Kill the installed app mid-note and reopen: everything up to the last **Saved** is there (as in the 09B list). | |

## C. Screen readers (TalkBack and VoiceOver)

| # | Check | Result |
|---|---|---|
| C1 | The medicine field is announced with its name and the list as options; the dose builder announces the chosen frequency and duration; **"Choose a frequency (1 to 5) and a duration such as 5d"** is read when Enter is refused. | |
| C2 | A line on the list is read as one item (number, medicine, dose); the remove button is named for its medicine; the **Undo** after a remove is announced. | |
| C3 | An allergy match is announced as an alert ("Matches allergy: …"); **Prescribe anyway…** and its reason field are named; the line then reads "Prescribed despite allergy: …". | |
| C4 | The finish review: the heading names the sheet, the summary region is "What the patient receives", an open allergy match is announced as an alert and **Sign** is announced as unavailable with the reason; the WhatsApp checkbox says whether it is ticked. | |
| C5 | The success screen: **Print Rx**, **Share PDF** (or **Download PDF**) and the WhatsApp button are reachable and named; focus is inside the sheet. | |
| C6 | **Take photo** and the upload rows (Uploading, Stored, Failed) are read; a refused photo reads its reason. | |

## D. The printer (A4 plain and A5 pre-printed)

| # | Check | Result |
|---|---|---|
| D1 | Chrome on a laptop: **Print Rx** on an A5, pre-printed prescription with the margins set to match your stationery. In the print dialog set **Margins: Default**, **Headers and footers: off**. The text starts below the letterhead and stops above the footer area; nothing prints on the pre-printed letterhead. | |
| D2 | The same in **Safari** on a Mac or an iPad: the same page size and margins. (The browser's own header and footer lines print inside the margins unless switched off: the stylesheet cannot remove them.) | |
| D3 | A4 on **blank paper**: the clinic header, the footer line "Generated by ClinicOS • Confidential Medical Record" and, at the bottom corner, "Rx v{n} · Page x of y" on every page (the page line comes from the browser's margin box on blank paper: Chrome 131 and later; in Safari it may be missing). | |
| D4 | A **long** prescription that runs onto a second page: the continuation line and the footer repeat, the table header repeats, no medicine row is cut in half. | |
| D5 | **Rx PDF** (the link beside Print Rx): print the PDF itself on the same paper: the margins are the same as the browser print. | |
| D6 | A patient with a **Hindi (Devanagari) name**: the PDF cannot draw it (known limit, P3): note what prints (the patient line is garbled but the prescription renders). Confirm the clinic accepts this until a Devanagari font is added. | |

## Send back

The four tables, the device, OS and browser details, and any screenshot or photo of the printed page (synthetic data only). Anything marked **Broken** blocks the phase's gate; **Awkward** goes to the backlog with an owner.
