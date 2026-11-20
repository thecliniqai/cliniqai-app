# V2-DX round 2 · What v1's consult screen lets a doctor do, and how fast

Source: v1 code on this branch (`components/consultation/*`, `features/prescriptions/schema.ts`,
`features/terminology/*`) and the M0 baseline (`.planning/phases/02-ci-e2e-foundations/evidence/m0-baseline/`,
commit `ade531f`). Counts marked **M0** were measured by the e2e counter. Counts marked *code* are derived by
reading the component (one click per button, one keystroke per typed character, the 120 ms debounce ignored).
Synthetic data only; no PHI.

The PO's brief for round 2 (binding): v1's functionality is the **floor**, not the model. Round 2 designs from a
broader UX view with two non-negotiables: **typing driven toward zero** for common cases (tap/select, learned
recents and favourites, one-tap templates, "same as last visit", a complaint → exam → diagnosis → Rx suggestion
chain, steppers and chips for dose/frequency/duration, bulk apply, keyboard shortcuts for those who type) and an
**airy, uncramped layout** with progressive disclosure at every width. Section 3 lists the floor; section 4 sets
the round-2 targets per step.

## 1. The v1 screen in one paragraph

`/consultation/[id]` is one long page (3,345 px tall at 1280, M0 screenshot) with seven anchor tabs: Vitals,
Complaints & Notes, Specialty Exam, Diagnosis, Prescription, Investigations & Advice, Follow-Up. Everything is
visible at once; nothing is progressive. Every section is a white card on a tinted canvas with 12 px type, 11 px
chips and 10 px code badges. The header carries a specialty `<select>` (GP / Dental / Pediatrics), History (slide-over
drawer with past encounters and "Repeat this Rx"), Save Draft, and "Complete & Sign ℞", which opens a modal with fee,
discount, a "collect at doctor's desk" toggle (default on), then WhatsApp / Print for the Rx and the receipt. An
AI Scribe modal and a returning-patient catch-up card exist behind flags. Autosave status is shown in the header.

**M0 measured flow** (notes + quick diagnosis + 2 custom medicines + sign, fee to reception):
**12 actions · 105 keystrokes · 8 clicks · 1.8 s.** Per step: Start Consultation (1 click) → notes (53 chars) →
quick diagnosis chip (1 click) → per medicine: type 26 chars, click "Add as custom medicine", click "Add to
Prescription" → Complete & Sign (1) → untick collect (1) → Sign & Route to Reception (1).

## 2. Why doctors found v1 "easier" despite the look

1. **Quick chips everywhere.** 12 complaint chips, 8 diagnosis chips per specialty, 14 investigation chips, 10
   advice chips, 6 follow-up chips. One tap adds an item with a sensible default (complaint = 3 days, follow-up =
   5 days pre-selected, Rx = 1-0-1 · After food · 5d).
2. **Staging with defaults.** Picking a medicine opens a staging panel where frequency, food timing and duration
   are already selected; the common case is one more click ("Add to Prescription").
3. **Nothing is hidden behind navigation.** No wizard, no page changes: every section is on one scroll.
4. **Memory of the doctor.** "Frequently prescribed by you for <diagnosis>" chips (SQL over past Rx, one tap adds
   the drug *with* its usual frequency and duration); protocol templates; Repeat last Rx; doctor custom catalog
   for medicines and diagnoses.
5. **Default-on finish.** The sign modal assumes the fee is collected at the desk, so the fast path is two clicks.

## 3. Capability inventory (the floor every one of these must clear in v2)

Legend: **taps** = clicks or taps · **chars** = typed characters · "default" = what the doctor gets with no extra action.

### 3.1 Vitals (`vitals-block.tsx`)
| Capability | v1 cost (*code*) | Notes |
|---|---|---|
| View vitals recorded by the front desk, with BMI | 0 | Six tiles: BP, Pulse, SpO₂, Temp, Wt/Ht, BMI |
| Automatic flags | 0 | BP > 140/90 "High BP", < 90/60 "Low BP"; pulse > 100 / < 60; SpO₂ < 95; temp > 99.5 / > 102; BMI bands |
| Record or edit vitals | 1 tap + 2–3 chars per field (7 fields) | "Record Vitals" opens inline inputs |

### 3.2 Chief complaints (`chief-complaints-section.tsx`)
| Capability | v1 cost | Notes |
|---|---|---|
| Add a common complaint | **1 tap** | 12 fixed chips (Fever, Cough, Cold & Congestion, Headache, Sore Throat, Loose Stools, Vomiting, Body Ache, Abdominal Pain, Loss of Appetite, Weakness, Skin Rash). Default duration **3 days** |
| Add 3 common complaints | **3 taps, 0 chars** | Chips grey out once added |
| Change a duration | 1 tap | Inline presets 1d 2d 3d 5d 1w 2w 1m |
| Custom complaint | n chars + Enter (or + 1 tap) | Free text input |
| Note on a complaint ("nocturnal, dry") | n chars | Inline text field per complaint |
| Remove | 1 tap | |
| History of present illness | n chars | One textarea (M0 typed 53) |
| Severity, onset, side, associated symptoms | **not available** | |
| Recents or favourites learned per doctor | **not available** | The 12 chips are hard-coded |

### 3.3 Examination (`specialty/gp-systemic-review.tsx`, `dental-odontogram.tsx`, `pediatrics-tools.tsx`)
| Capability | v1 cost | Notes |
|---|---|---|
| Switch specialty template | 2 taps (select, option) | GP / Dental / Pediatrics; header `<select>` |
| GP PICCLE signs (pallor, icterus, cyanosis, clubbing, lymphadenopathy, edema) | **1 tap each**; default **all absent** | Six tiles, Present/Absent |
| GP systemic: CVS, RS, PA, CNS | **typed, ~25–50 chars each** | Four textareas. The "normal" strings are **placeholders, not values**: leaving them blank records nothing. Recording a normal systemic exam costs ≈ 150 chars |
| One abnormal finding (e.g. "crepts right base") | ≈ 20 chars | Typed into the RS textarea |
| Exam templates / tile grids with pre-filled defaults | **not available** | |
| Dental odontogram | 2 taps per tooth (tooth, condition) | FDI adult + deciduous, six conditions |
| Pediatrics | typed numbers | Weight / height / head circumference → WHO LMS percentiles and Z-scores, immunisation notes |

### 3.4 Diagnosis (`diagnosis-section.tsx`)
| Capability | v1 cost | Notes |
|---|---|---|
| Quick diagnosis | **1 tap**; shows ICD-11 code | 8 fixed chips per specialty (GP: URTI, Viral fever, AGE, HTN, T2DM, bronchitis, allergic rhinitis, migraine) |
| Search (name, ICD-11, SNOMED, doctor custom) | n chars + 1 tap | Debounced 120 ms, 15 results, chronic and "Doctor Custom" badges |
| Add a custom diagnosis | n chars + 1 tap | Saved to the doctor's personal catalog |
| Mark chronic | 0 (comes with the term) | |
| Note on a diagnosis | 1 tap + n chars + Enter | |
| Remove | 1 tap | |
| Suggestions from complaints, recents, favourites | **not available** | |

### 3.5 Prescription (`prescription-builder.tsx`, `frequent-rx-chips.tsx`, `features/prescriptions/schema.ts`)
| Capability | v1 cost | Notes |
|---|---|---|
| Medicine search (CDCI brand or generic) | n chars + 1 tap → staging panel | Shows dose form, generic, "★ Doctor Favorite" |
| Staging defaults | 0 | Frequency **1-0-1**, food **After food**, duration **5d**, or the drug's own defaults from the formulary |
| Frequency presets | 1 tap | 1-0-1, 1-0-0, 0-0-1, 1-1-1, 1-0-1-0, 0-1-0, 1-1-1-1, SOS (+ custom text) |
| Food relation | 1 tap | After / Before / With food, Empty stomach |
| Duration presets | 1 tap | 3d 5d 7d 10d 1w 2w 1m (+ custom text; `normalizeDuration` turns 5d into "5 days") |
| Special instructions | n chars | |
| Commit the staged drug | **1 tap** ("Add to Prescription") | |
| **One medicine with standard dosing, from search** | **≈ 8–10 chars + 2 taps** | type, pick, add |
| **One medicine as a custom entry** (M0) | **26 chars + 2 taps** | measured |
| "Frequently prescribed by you for <diagnosis>" | **1 tap per drug**, 0 chars | Deterministic SQL (`getFrequentPrescriptionsAction`, limit 6); adds drug **with** its usual frequency and duration. Appears only once a diagnosis exists |
| Repeat last Rx | **1 tap** (header button, when a past Rx exists) · or History → "Repeat this Rx" = 2 taps | Copies every item of the most recent Rx |
| Protocol templates | 2 taps (open, Apply) then a **full page reload** | Save = name (n chars) + 1 tap |
| Remove a line | 2 taps (trash, confirm) | |
| Edit a committed line | **not available** (remove and re-add) | |
| Allergy warning | 0 | Amber banner listing recorded allergies; no per-drug match |
| Interaction or duplicate check | **not available** | |

### 3.6 Investigations, advice (`consultation-workspace.tsx` §6)
| Capability | v1 cost | Notes |
|---|---|---|
| Investigation chip | 1 tap | 14 fixed (CBC, FBS, PPBS, HbA1c, TSH, lipid, urine R/M, CXR, creatinine/KFT, LFT, electrolytes, uric acid, ECG, USG abdomen) |
| Custom test | n chars + Enter | |
| Advice chip | 1 tap | 10 fixed |
| Custom advice | n chars + Enter | |
| Diagnosis-linked suggestions | **not available** | |

### 3.7 Follow-up, referral, attachments (`consultation-workspace.tsx` §7)
| Capability | v1 cost | Notes |
|---|---|---|
| Follow-up interval | **0 taps (5 days pre-selected)**; 1 tap to change | None / 3 d / 5 d / 1 w / 2 w / custom date; recommended date shown; instructions text |
| Refer to a specialist | 1 tap → modal | |
| Upload lab report or radiograph | 1 tap + file picker | JPEG, PNG, PDF ≤ 10 MB |

### 3.8 Header and finish (`consultation-workspace.tsx`, `sign-and-bill-modal.tsx`, `pdf-preview-modal.tsx`)
| Capability | v1 cost | Notes |
|---|---|---|
| Patient identity, allergies, phone, UHID | 0 | Allergy is an amber chip in the header |
| History drawer (past encounters, Rx, Repeat this Rx) | 1 tap to open | |
| Autosave + Save Draft | 0 / 1 tap | |
| Complete & Sign | **2 taps minimum** (open, sign) with fee collected at the desk; **3** when routing to reception (M0) | Fee and discount editable; payment mode and UTR when collecting |
| After signing: WhatsApp Rx, Print Rx, WhatsApp receipt, Print receipt, PDF preview | 1 tap each | |
| Amend a signed note (reason required) | 1 tap → modal | `amendment-modal.tsx` |
| AI scribe (flagged), returning-patient catch-up (flagged) | 1 tap | Behind `features/ai` flags |
| Section navigation | 1 tap per tab (7 anchors) | No keyboard shortcuts |

## 4. v1 cost of the five PO benchmark steps (and the round-2 target)

| Step | v1 fast path | v1 taps | v1 chars | Round-2 target |
|---|---|---|---|---|
| A. Add 3 complaints (with durations) | 3 quick chips, default 3 d | 3 | 0 | ≤ 3 taps, 0 chars; durations visible and one tap to change; recents learned |
| B. Apply an exam template with one abnormal finding | No template. PICCLE all absent by default; type CVS/RS/PA/CNS normals (≈ 150 chars) plus the finding (≈ 20) | 0 | **≈ 170** | **≤ 3 taps, 0 chars** (template → system → finding tile) |
| C. Add a diagnosis | Quick chip if it is in the 8 | 1 | 0 | 1 tap, with suggestions ranked from the complaints so the needed one is on screen |
| D. 3-drug Rx with standard dosing | Per drug: type ≈ 9 chars, pick, Add | 6 | ≈ 27 (M0: 78 as custom) | **1 tap** for "your usual for this diagnosis" or ≤ 3 taps from favourites; 0 chars |
| E. Finish the consult | Complete & Sign → Sign & Collect | 2 (M0: 3) | 0 | ≤ 2 taps, with WhatsApp and the billing hand-off defaulted from clinic settings |
| **Whole consult (A–E)** | | **12** (M0 rules: 12 actions) | **≈ 197** (M0: 105 with a shorter note and no exam) | **≤ 9 taps, 0 chars** on the common path |

## 5. What is slow or missing in v1, in priority order

1. **Examination is typed.** Placeholders look like values but save nothing. This is the largest hidden typing
   cost on the page and the reason exam fields are often left empty.
2. **No learning per doctor** except the Rx frequency chips. Complaints, diagnoses, investigations and advice are
   fixed lists; a dermatologist sees "Loose Stools" forever.
3. **No chain.** Complaints do not rank diagnoses; a diagnosis does not propose investigations, advice or a
   follow-up interval; only the Rx chips use the diagnosis.
4. **No bulk apply** except Repeat last Rx and templates (which reload the page).
5. **Committed Rx lines cannot be edited**, and removal needs a confirm dialog.
6. **Everything is 11–12 px**, the canvas is tinted, and seven dense cards are stacked; at 360 px the page is
   5,300 px tall.
7. **No keyboard path**: no shortcuts, Enter on a search does not pick the top match, the staging panel needs the
   mouse.

Round 2 keeps every row in section 3 reachable from the consult screen and attacks items 1–7 directly.
