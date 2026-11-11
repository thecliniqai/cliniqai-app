---
phase: "03"
slug: "consultation-prescribing"
status: "draft"
shadcn_initialized: false
preset: "none"
created: "2026-10-11"
---

# Phase 03 — UI Design Contract: Consultation & Prescribing

> Visual and interaction contract for Phase 03 (Outpatient Consultation Workspace, Specialty Templates, Curated Terminology, India CDCI Prescribing, and PDF Letterhead Engine).
> Canonical design authority: `DESIGN.md` (light-only, #1769E0 healthcare blue, Inter font, 4px spacing grid, 44px mobile touch targets).

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (TailAdmin Free + Radix Primitives + Tailwind CSS v4 `@theme`) |
| Preset | TailAdmin Free Next.js Clean Clinical Preset |
| Component library | Custom Tailwind v4 primitives in `components/ui/` with Lucide icons |
| Icon library | `lucide-react` (v1.16.0) |
| Font | Inter (`font-sans`, strictly 2 weights: 400 Regular, 600 Semibold) |
| Theme Mode | Strictly Light Theme Only (zero dark mode, zero dark navigation shells) |

---

## Component Inventory

Enumerated by `find components/ui -name "*.tsx"` — 11 components — tailwindcss@^4.0.12 — 2026-10-11.

| Component | Import path | Notes |
|-----------|-------------|-------|
| `Button` | `@/components/ui/button` | Variants: `primary`, `secondary`, `outline`, `ghost`, `danger`. Minimum height 44px on mobile (`md`), 48px (`lg`), 36px (`sm`). Built-in spinner. |
| `Input` | `@/components/ui/input` | Form input with optional `startIcon`/`endIcon`, `min-h-[44px]`, `invalid` red border/ring, focus ring `#1769E0`. |
| `Select` | `@/components/ui/select` | Styled native select dropdown with chevron icon, `min-h-[44px]`, custom focus styling. |
| `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`, `ComponentCard` | `@/components/ui/card` | Information containers: `rounded-xl border border-gray-200 bg-white shadow-theme-xs`. Header/footer divider styling. |
| `Badge`, `StatusBadge` | `@/components/ui/badge` | Status tags: `light` and `solid` variants across `primary`, `success`, `warning`, `error`, `info`, `gray`. Specialized clinical visit statuses (`waiting`, `in_consultation`, `completed`). |
| `Field` | `@/components/ui/field` | Form label, asterisk indicator (`*`), helper text, and accessible error message (`id="${htmlFor}-error"`). |
| `TableContainer`, `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` | `@/components/ui/table` | Data tables with subtle hairline borders, `text-sm`, `divide-gray-100`, hover states. |
| `Modal` | `@/components/ui/modal` | Accessible dialogs with Escape key listener, backdrop blur (`bg-gray-900/50`), `max-w-md` to `max-w-xl`. |
| `Dropdown`, `DropdownItem` | `@/components/ui/dropdown` | Popover menus with outside-click listener, alignment options, danger item support. |
| `Alert` | `@/components/ui/alert` | Inline callout banners (`info`, `success`, `warning`, `error`) with standard icons and dismiss action. |
| `EmptyState` | `@/components/ui/empty-state` | Clean placeholder container with icon tile, title, supporting body copy, and CTA button. |

### Layout Shell Integration (`components/layout/`)

- `AppLayoutShell` (`@/components/layout/app-layout-shell`): Coordinates responsive desktop sidebar and top header.
- `AppSidebar` (`@/components/layout/app-sidebar`): 290px desktop expanded, off-canvas drawer on mobile.
- `AppHeader` (`@/components/layout/app-header`): 64px sticky top header with mobile drawer toggle and user menu.
- `Backdrop` (`@/components/layout/backdrop`): Off-canvas mobile backdrop.

---

## Spacing Scale

Declared values strictly adhere to the 4px base grid (`DESIGN.md` §7). Every token value is a strict multiple of 4 (odd values including 6px are forbidden; compact element spacing uses 4px or 8px):

| Token | Value | Tailwind Class | Usage |
|-------|-------|----------------|-------|
| 1 | 4px | `p-1`, `gap-1`, `space-y-1` | Inline micro-gaps, chip icon margins, small badges, compact chip padding |
| 2 | 8px | `p-2`, `gap-2`, `space-x-2` | Tight element spacing, chip horizontal padding, button gap |
| 3 | 12px | `p-3`, `gap-3` | Compact card padding, inside-form grouping |
| 4 | 16px | `p-4`, `gap-4`, `space-y-4` | Field-to-field spacing, mobile container padding, table cell vertical |
| 5 | 20px | `p-5`, `gap-5` | Standard card internal padding, medium section gaps |
| 6 | 24px | `p-6`, `gap-6` | Major section-to-section separation, page horizontal padding |
| 8 | 32px | `p-8`, `gap-8` | Major layout breaks, consultation block separators |
| 10 | 40px | `p-10`, `gap-10` | Empty state padding, large container breaks |
| 12 | 48px | `p-12`, `gap-12` | Desktop page header padding |
| 16 | 64px | `p-16`, `h-16` | Top bar height (`64px`), major layout margins |

### Touch Target Guarantees

- **Mobile Minimum Touch Target:** Strictly `44 × 44px` on all mobile clickable targets (`button`, `input`, `select`, tooth items, chips).
- **Desktop Controls:** `40px` height with comfortable mouse targets.

---

## Typography

Strictly **Inter** font family (`DESIGN.md` §6). Consolidated to exactly 4 font sizes and strictly 2 font weights (`400` Regular and `600` Semibold). Weight `500` is removed to enforce crisp typographic contrast without ambiguous intermediary weights. No display or serif fonts.

| Role | Size | Weight | Line Height | Letter Spacing | CSS / Tailwind Class | Usage |
|------|------|--------|-------------|----------------|----------------------|-------|
| Display | 24px (`text-2xl`) | 600 (`font-semibold`) | 1.3 (`leading-snug`) | -0.3px (`tracking-tight`) | `text-2xl font-semibold text-gray-900 tracking-tight` | Workspace page titles, major modal headers |
| Heading | 18px (`text-lg`) | 600 (`font-semibold`) | 1.4 (`leading-snug`) | -0.2px (`tracking-tight`) | `text-lg font-semibold text-gray-900` | SOAP section titles, major card headers |
| Body | 14px (`text-sm`) | 400 (`font-normal`) | 1.5 (`leading-relaxed`) | Normal | `text-sm font-normal text-gray-700 leading-relaxed` | Clinical notes, medication names, dosage descriptions, tabular figures |
| Caption / Label | 12px (`text-xs`) | 600 (`font-semibold`) | 1.4 (`leading-normal`) | Normal | `text-xs font-semibold text-gray-600` | Form labels, status badges, tooth numbers, metadata captions, button labels |

---

## Color

The application maintains a daylight-oriented, neutral foundation (`DESIGN.md` §5). Zero dark mode.

| Role | Token / Hex | Usage |
|------|-------------|-------|
| Dominant (60%) | `#F7F6F3` (Canvas) / `#FFFFFF` (Surface) | Application background canvas (`#F7F6F3`), card surfaces (`#FFFFFF`), form panels, table backgrounds. |
| Secondary (30%) | `#ECEEF0` (Muted) / `#E4E5E7` (Border) / `#F2F3F4` (Subtle) | Card borders (`#E4E5E7`), section dividers (`#ECEDEF`), disabled states (`#F1F2F4`), input outlines (`#C9CCD1`). |
| Accent (10%) | `#1769E0` (Canonical Healthcare Blue) | Strictly reserved for: Primary CTA buttons ("Complete & Sign"), active navigation link indicators, selected dosage chips, focused input borders, and primary interactive links. |
| Destructive | `#B42318` (Error Red) | Destructive action confirmation, critical abnormal vitals (BP > 140/90, SpO2 < 95%), remove medication row button. |

### Semantic Color Matrix

| State | Background | Text | Border | Usage in Phase 03 |
|-------|------------|------|--------|-------------------|
| **Info / Primary** | `#EAF2FF` | `#1769E0` | `#BFD8FF` | "In Consultation" status badge, selected specialty pill, active section jump indicator. |
| **Warning** | `#FFF5E5` | `#9A5B00` | `#F3D39A` | Patient Allergy Warning Banner, borderline abnormal vitals (BP 130-139, Temp > 99.5°F), pediatric growth 3rd–15th percentile. |
| **Success** | `#EAF7F0` | `#18794E` | `#BDE5CF` | "Completed" status badge, normal vitals, normal growth percentiles (15th–85th), immunization "Given" badge. |
| **Error / Critical** | `#FDECEA` | `#B42318` | `#F2B8B5` | Critical abnormal vitals, allergy conflict highlight, severe stunting (<3rd percentile), invalid input error text. |
| **Neutral / Muted** | `#F1F2F4` | `#5A5A5A` | `#D9DCE0` | Unselected dosage chips, inactive jump pills, skipped immunization tag. |

### Dental Odontogram Palette (FDI Tooth Conditions)

| Condition | Fill Hex | Border / Stroke Hex | Text / Badge | Meaning |
|-----------|----------|---------------------|--------------|---------|
| Sound / Healthy | `#FFFFFF` | `#CBD5E1` (Slate-300) | `text-slate-600` | Natural sound tooth |
| Decay / Caries | `#FEE2E2` (Red-100) | `#EF4444` (Red-500) | `text-red-700` | Active cavity requiring restoration |
| Crown / Cap | `#FEF3C7` (Amber-100) | `#F59E0B` (Amber-500) | `text-amber-800` | Prosthetic crown installed |
| Missing | `#F1F5F9` (Slate-100) | `#64748B` (Slate-500 cross) | `text-slate-500` | Tooth congenitally missing or extracted |
| Root Canal (RCT) | `#F3E8FF` (Purple-100) | `#A855F7` (Purple-500) | `text-purple-700` | Endodontically treated tooth |
| Filled / Restoration | `#DBEAFE` (Blue-100) | `#3B82F6` (Blue-500) | `text-blue-700` | Existing amalgam/composite restoration |
| Extraction Advised | `#FFE4E6` (Rose-100) | `#991B1B` (Rose-800 dashed) | `text-rose-900` | Indicated for surgical/simple extraction |

---

## Screen & Component Layout Contracts

### Visual Focal Point & Hierarchy Guarantees

In accordance with `DESIGN.md` §2.7 (One Primary Action) and visual hierarchy standards:
- **Primary Visual Focal Point:** The dominant top-right **`Complete & Sign ℞`** CTA button rendered in canonical healthcare blue (`#1769E0`), paired with the central active **Electronic Prescription (Rx Builder)** card surface (`rounded-xl border border-gray-200 bg-white`). The prescription builder functions as the core operational output of the outpatient consultation, while the high-contrast blue `Complete & Sign ℞` button anchors the completion state.
- **Secondary Surfaces & Visual Recedence:** All auxiliary sections (Vitals, PICCLE toggles, Terminology search, History drawer) utilize calm neutral surfaces (`#FFFFFF` surface on `#F7F6F3` canvas), subtle hairlines (`#E4E5E7`), and muted borders to ensure zero visual competition with the prescription workflow.

### Accessibility & Icon-Only Button Affordances

All icon-only buttons, dismiss affordances, and interactive chips MUST provide explicit accessible screen-reader labels:
- `aria-label="Remove diagnosis"` on diagnosis row delete buttons (`[✕]`)
- `aria-label="Dismiss complaint"` on active complaint chips (`[✕]`)
- `aria-label="Remove medication"` on prescription medication row trash buttons (`[✕]`)
- `aria-label="Close modal"` on dialog dismiss buttons (`[✕]`)
- `aria-label="Close patient history drawer"` on history slide-over panel close button
- `aria-label="Close preview"` on PDF preview modal close button
- `aria-label="Edit vitals"` on vitals card edit button
- **Touch Target Floor:** All interactive controls, icon buttons, and tooth cells enforce a strict minimum clickable hit area of `44 × 44px` on mobile (`p-2.5` padding / `min-w-[44px] min-h-[44px]`).

---

### 1. Consultation Workspace (`app/(dashboard)/consultation/[id]/page.tsx`)

A single-page, fast-scrolling SOAP workspace designed for high-throughput Indian OPD clinics (3-minute consultation target, zero tab switching per D-01).

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ STICKY WORKSPACE HEADER (Height: 64px, z-30, bg-white, border-b border-gray-200)       │
│ [← Back to Queue]  Rahul Sharma (35y M) • Token #4  [In Consultation]                 │
│ Specialty: [General Physician ▾]   [Save Draft]   [Complete & Sign ℞]                  │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ STICKY SECTION JUMP BAR (Height: 44px, z-20, bg-gray-50/90, backdrop-blur-xs)          │
│ [ Vitals ]  [ Complaints & HPI ]  [ Exam & Specialty ]  [ Diagnosis ]  [ Rx ] [ Advice ]│
│ Right slot: [ ⏱ Saved 2m ago ]  [ 📋 Open Patient History (3) ]                        │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ MAIN SCROLL CONTAINER (max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-8)                 │
│                                                                                        │
│ 1. PATIENT ALLERGY ALERT BANNER (If allergies recorded on patient profile)             │
│    [!] Known Allergies: Penicillin, Sulfa Drugs. Manual clinical review advised.      │
│                                                                                        │
│ 2. VITALS SECTION (Card: rounded-xl border border-gray-200 bg-white p-5)               │
│    BP: [120/80] mmHg   Pulse: [72] bpm   SpO2: [98] %   Temp: [98.6] °F                │
│    Weight: [68] kg     Height: [172] cm  BMI: 23.0 kg/m² [Normal]                      │
│    Recorded by: Nurse Priya at 10:15 AM  [Edit Vitals]                                 │
│                                                                                        │
│ 3. CHIEF COMPLAINTS & CLINICAL NOTES                                                   │
│    Quick Chips: [+ Fever] [+ Cough] [+ Cold] [+ Headache] [+ Vomiting] [+ Loose Stool] │
│    Active Chips: [Fever x 3 days ✕]  [Dry Cough x 5 days ✕]                            │
│    Clinical Notes: [ Textarea: History of present illness, symptom onset...        ]   │
│                                                                                        │
│ 4. EXAMINATION & SPECIALTY TEMPLATES (Dynamic container based on selected specialty)   │
│    • General Physician: General physical signs (PICCLE) + Systemic Exam (CVS, RS, etc)│
│    • Dental: Interactive SVG Odontogram (FDI 11-48, 51-85) + Procedure Notes           │
│    • Pediatrics: Birth History + WHO Growth Percentiles (LMS) + IAP Vaccine Checklist  │
│                                                                                        │
│ 5. DIAGNOSIS CODING (Terminology Search & Row List)                                    │
│    Quick Specialty Chips: [Viral Fever] [Acute URTI] [Acute Bronchitis] [Hypertension] │
│    Search: [ ⌕ Search diagnosis (ICD-11 / SNOMED CT)...                           ]    │
│    Selected Diagnoses Table:                                                           │
│    • Acute Upper Respiratory Tract Infection [ICD-11: CA40]  [+ Add Note] [☑ Chronic]│
│      (Remove button: red cross icon with aria-label="Remove diagnosis")                │
│                                                                                        │
│ 6. ELECTRONIC PRESCRIPTION (Rx Builder — Primary Operational Focal Point)              │
│    Toolbar: [⚡ Repeat Last Rx]  [📚 Protocol Templates ▾]  [+ Custom Medicine]        │
│    Search: [ ⌕ Search brand, generic salt, or CDCI medicine...                   ]    │
│    Medication Rows:                                                                    │
│    ┌───────────────────────────────────────────────────────────────────────────────┐   │
│    │ Augmentin 625 Duo Tablet                                                      │   │
│    │ Amoxicillin 500mg + Clavulanic Acid 125mg • GlaxoSmithKline                   │   │
│    │ Frequency: [1-0-1] [1-0-0] [0-0-1] [1-1-1] [SOS]                              │   │
│    │ Food:      [After food] [Before food] [With food]                             │   │
│    │ Duration:  [3d] [5d] [7d] [10d] [1m] [Custom]                                 │   │
│    │ Instructions: [ Take with a full glass of water                             ] │   │
│    └───────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                        │
│ 7. INVESTIGATIONS ADVISED & CLINICAL ADVICE                                            │
│    Investigations: [+ CBC] [+ Blood Sugar] [+ HbA1c] [+ Thyroid] [+ Chest X-ray]      │
│    Diet & Advice:  [+ Warm saline gargle] [+ Steam inhalation] [+ Plenty of fluids]    │
│    Advice Text:    [ Textarea for specific patient advice...                       ]   │
│                                                                                        │
│ 8. FOLLOW-UP & CLINICAL ATTACHMENTS                                                    │
│    Follow-up: [3 Days] [5 Days] [1 Week] [2 Weeks] [Custom Date Picker: 16-Oct-2026]  │
│    Dropzone:  [ Drag & drop clinical reports, X-rays (JPEG/PNG/PDF < 10MB) ]           │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### 2. Vitals Block & Abnormal Badging (D-02)

- **Layout:** Responsive grid — `grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3`.
- **Inputs:** Numeric inputs with unit suffixes (`mmHg`, `bpm`, `%`, `°F`, `kg`, `cm`).
- **Abnormal Badge Contracts:**
  - BP: Systolic > 140 or Diastolic > 90 → Badge `error` "High BP"
  - BP: Systolic < 90 or Diastolic < 60 → Badge `warning` "Low BP"
  - Pulse: > 100 bpm → Badge `warning` "Tachycardia"; < 60 bpm → Badge `warning` "Bradycardia"
  - SpO2: < 95% → Badge `error` "Low Oxygen"
  - Temp: > 99.5°F → Badge `warning` "Fever"; > 102.0°F → Badge `error` "High Fever"
  - BMI: Auto-calculated `(Weight / (Height/100)^2)`.
    - `< 18.5`: Badge `warning` "Underweight"
    - `18.5 – 24.9`: Badge `success` "Normal"
    - `25.0 – 29.9`: Badge `warning` "Overweight"
    - `>= 30.0`: Badge `error` "Obese"
- **Nurse/Doctor Attribution:** Subtext: `Recorded by Nurse [Name] at [Time]` with 1-click `[Edit Vitals]` button (`aria-label="Edit vitals"`).

---

### 3. Specialty Templates Layer (D-03, D-04)

#### A. General Physician Template
- **PICCLE Signs:** Row of 6 toggles: Pallor, Icterus, Cyanosis, Clubbing, Lymphadenopathy, Edema (`Absent` [gray] / `Present` [amber]).
- **Systemic Exam Fields:** 4 collapsible accordions or side-by-side text inputs:
  - CVS (Cardiovascular System) — placeholder: "S1 S2 heard, no murmurs"
  - RS (Respiratory System) — placeholder: "Bilateral vesicular breath sounds, no added sounds"
  - PA (Per Abdomen) — placeholder: "Soft, non-tender, no organomegaly"
  - CNS (Central Nervous System) — placeholder: "Conscious, oriented, no focal neurological deficits"

#### B. Dental Odontogram Template
- **Tooth Numbering Standard:** FDI Two-Digit Notation.
  - Adult Upper: `18` to `11` (Right quadrant) | `21` to `28` (Left quadrant)
  - Adult Lower: `48` to `41` (Right quadrant) | `31` to `38` (Left quadrant)
  - Deciduous (Pediatric): `55` to `51` | `61` to `65` (Upper) and `85` to `81` | `71` to `75` (Lower). Mode toggled via segmented switch `[Adult (32)]` vs `[Deciduous (20)]`.
- **SVG Anatomical Presentation:**
  - Individual tooth cells measuring `44 × 54px` (touch compliant).
  - Crown and root vector paths with tooth number clearly visible in `12px font-semibold` (Caption / Label style).
  - Condition fills match Dental Palette above.
- **Tooth Interaction Popover:**
  - Clicking a tooth opens a floating card popover (`shadow-theme-md rounded-xl p-3 bg-white border border-gray-200 z-40`).
  - Condition chips: `Decay`, `Crown`, `Missing`, `RCT`, `Filled`, `Extract Advised`.
  - Optional tooth note input (`min-h-[36px] text-xs`).
  - Action: `[Save Conditions]` / `[Clear Tooth Conditions]`.
- **Summary Table:** Rendered below odontogram:
  - Columns: `Tooth #`, `Surface/Area`, `Condition`, `Notes / Advised Procedure`, `Action (Remove)`.

#### C. Pediatrics Template
- **Birth History:** Compact 4-field card:
  - Gestational Age: `Full Term` / `Preterm (<37w)`
  - Birth Weight: Number input (kg)
  - Delivery: `Normal Vaginal` / `LSCS (Caesarean)`
  - NICU Stay: `No` / `Yes (duration)`
- **WHO LMS Growth Percentile Calculator:**
  - Real-time calculation based on patient DOB/age and current visit vitals (Weight, Height, Head Circumference).
  - Displays numerical percentile and colored badge:
    - `< 3rd`: Badge `error` "Underweight / Stunted (<3rd %ile)"
    - `3rd – 15th`: Badge `warning` "Below Average (10th %ile)"
    - `15th – 85th`: Badge `success` "Normal (50th %ile)"
    - `85th – 97th`: Badge `warning` "Above Average (90th %ile)"
    - `> 97th`: Badge `error` "Overweight / High (>97th %ile)"
- **IAP Immunization Checklist (Indian Academy of Pediatrics):**
  - Accordion grouped by milestone age: `Birth`, `6 Weeks`, `10 Weeks`, `14 Weeks`, `6 Months`, `9 Months`, `12 Months`, `15 Months`, `18 Months`, `2 Years`, `5 Years`, `10 Years`.
  - Interactive status chips per vaccine:
    - BCG, Hep B, OPV, Pentavalent, Rotavirus, PCV, IPV, MMR, Typhoid, Varicella, Hep A, DPT Booster.
    - Status toggle: `Given` (green pill), `Due` (amber pill), `Delayed` (red pill), `Skipped` (gray pill).

---

### 4. Diagnosis Coding & Terminology (D-21 to D-26)

- **Search Dropdown (`min-h-[44px]`):**
  - Query searches ~1,500 curated outpatient conditions with sub-100ms response time.
  - Dropdown row layout:
    ```
    ┌────────────────────────────────────────────────────────┐
    │ Acute Upper Respiratory Tract Infection                │
    │ [ICD-11: CA40]  [SNOMED: 54150009]  • Respiratory      │
    └────────────────────────────────────────────────────────┘
    ```
  - Custom Diagnosis: When no exact match is found, last row offers: `+ Add custom diagnosis "{query}"`.
- **Diagnosis Row Container:**
  - Disease name: `text-sm font-semibold text-gray-900`.
  - Codes: Subdued `text-xs text-gray-500` in UI (omitted on printed PDF per D-23).
  - Inline Note: `+ Add Note` expands a single-line input (`placeholder="e.g. Mild exacerbation, 3 days"`).
  - Chronic Checkbox: `[☑ Save to Chronic Conditions]` — persists to patient record upon completion.
  - Remove button: Red trash/cross icon (`min-h-[44px] min-w-[44px]`, with `aria-label="Remove diagnosis"`).

---

### 5. Prescription Builder & India OPD Dosage Chips (D-11 to D-19)

- **Toolbar:**
  - `[⚡ Repeat Last Rx]` (1-click pre-populates previous visit medications)
  - `[📚 Protocol Templates ▾]` (Dropdown of doctor's saved templates)
  - `[+ Custom Medicine]` (Opens free-text medicine entry)
- **Allergy Banner:**
  - Rendered immediately above drug search: `bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-lg flex items-center gap-2`.
  - Content: `⚠ Known Allergies: Penicillin, Sulfa Drugs. Manual clinical review recommended.`
- **CDCI Drug Search Dropdown:**
  - Sub-100ms fuzzy search with doctor favorites prioritized.
  - Dropdown row layout:
    ```
    ┌────────────────────────────────────────────────────────┐
    │ ★ AUGMENTIN 625 DUO TABLET                             │
    │ Amoxicillin 500 mg + Clavulanic Acid 125 mg            │
    │ Form: Tablet • Supplier: GlaxoSmithKline               │
    └────────────────────────────────────────────────────────┘
    ```
- **Dosage Chips (Fast Indian OPD 1-Tap Entry):**
  - **Frequency:** `[1-0-1]` (Selected: `#1769E0` blue pill), `[1-0-0]`, `[0-0-1]`, `[1-1-1]`, `[1-0-1-0]`, `[SOS]`, `[Custom]`.
  - **Food Timing:** `[After food]` (Default selected), `[Before food]`, `[With food]`, `[Empty stomach]`.
  - **Duration:** `[3d]`, `[5d]` (Default selected), `[7d]`, `[10d]`, `[14d]`, `[1m]`, `[Custom]`.
  - **Instructions:** Quick chips: `[With warm water]`, `[Do not crush]`, `[Apply locally]` + free text input.
  - **Remove Row Action:** Red trash button (`min-h-[44px] min-w-[44px]`, `aria-label="Remove medication"`).
- **Printed PDF Hygiene (D-16):**
  - Renders Brand Name in bold uppercase with Generic composition / salt underneath.

---

### 6. PDF Preview & Dual Letterhead Modal (D-28, D-29, D-30, D-31)

- **Trigger:** "Preview Prescription PDF" secondary button or automatically upon clicking "Complete & Sign".
- **Modal Specifications (`maxWidth="xl"`):**
  - Dimensions: `w-full max-w-4xl h-[90vh] flex flex-col`.
  - Header:
    - Title: `Prescription Preview — Rahul Sharma (Visit V-1049)`
    - Segmented Control Switcher (`DESIGN.md` §14.2):
      `[ 📄 Print on Blank Paper ]` vs `[ 📋 Print on Pre-Printed Letterhead ]`
  - Mode Specifications:
    - **Mode 1 (Blank Paper):** Full clinic logo, clinic name, address, contact, registration number, doctor name and qualifications printed at top.
    - **Mode 2 (Pre-Printed Letterhead):** Header top margin offset `110pt (~39mm)` and footer bottom margin offset `60pt (~21mm)` leaving physical stationery blank for clinic pre-printed pad.
  - Viewer: Embedded `<iframe>` displaying server-generated signed PDF URL with zoom controls.
  - Footer Toolbar:
    - Left slot: `Version: v1 • Generated 11-Oct-2026 10:45 AM`
    - Right slot:
      - `[Print Prescription]` (Secondary button with printer icon, triggers `iframe.contentWindow.print()`)
      - `[Download PDF]` (Primary button with download icon)
      - `[Close Preview]` (Ghost button with `aria-label="Close preview"`)

---

### 7. Longitudinal History Side Drawer (D-06)

- **Trigger:** Top bar `[📋 Open Patient History (3)]` button.
- **Drawer Behavior:** Slide-over right panel (`w-full sm:max-w-md bg-white shadow-theme-lg border-l border-gray-200 z-50`). Close button provides `aria-label="Close patient history drawer"`.
- **Content:**
  - Chronological timeline of patient's past visits at this clinic.
  - Each visit card displays:
    - Visit Date & Doctor Name
    - Diagnoses recorded
    - Prescribed medications list
    - 1-Click Action Buttons:
      - `[⚡ Repeat this Rx]`: Pre-populates all medications into current consultation draft.
      - `[📄 Copy Notes]`: Appends examination notes to current draft.

---

### 8. Post-Sign-Off Amendment Modal & Versioning (D-05, D-17)

- **Trigger:** "Amend Consultation" button when viewing an already `completed` visit.
- **Warning Callout:**
  - `Alert` component with `warning` type:
    `"This consultation was finalized and signed on 11-Oct-2026 by Dr. Ramesh Rao. Modifying this record will increment the prescription to v2, save an immutable audit snapshot in visit_revisions, and mark the PDF as amended."`
- **Required Form:**
  - Mandatory `Field` with label `"Reason for Amendment *"`:
  - Textarea (`min-h-[80px]`): Placeholder: `"e.g. Adjusted antibiotic dosage due to gastric intolerance reported by patient."`
- **Actions:**
  - `[Cancel Amendment]` (Secondary button)
  - `[Confirm & Unlock for Editing]` (Primary button)

---

## Copywriting Contract

### Primary CTAs (Verb + Specific Noun)

| Location | Action | Button Text | Variant |
|----------|--------|-------------|---------|
| Workspace Top Bar | Finalize consultation | `Complete & Sign ℞` | `primary` (Dominant #1769E0) |
| Workspace Top Bar | Save work in progress | `Save Draft` | `secondary` |
| Workspace Top Bar | Open history drawer | `Open Patient History` | `outline` |
| Vitals Card | Modify recorded vitals | `Edit Vitals` | `outline` |
| Completed Visit Header | Re-open signed visit | `Amend Consultation` | `secondary` |
| Amendment Modal | Dismiss modal without changes | `Cancel Amendment` | `secondary` |
| Amendment Modal | Confirm amendment | `Confirm & Unlock for Editing` | `primary` |
| Prescription Builder | Pre-populate last Rx | `Repeat Last Rx` | `secondary` (with spark icon) |
| Prescription Builder | Add single drug | `Add Medication` | `primary` |
| Prescription Builder | Save current Rx as template | `Save as Protocol Template` | `outline` |
| PDF Preview Modal | Send to local printer | `Print Prescription` | `secondary` (with printer icon) |
| PDF Preview Modal | Save file to device | `Download PDF` | `primary` (with download icon) |
| PDF Preview Modal | Dismiss modal | `Close Preview` | `ghost` |
| Dental Odontogram Popover | Save tooth state | `Save Conditions` | `primary` |
| Dental Odontogram Popover | Clear tooth conditions | `Clear Tooth Conditions` | `danger` |
| Attachments Dropzone | Pick file from disk | `Upload Clinical File` | `secondary` |

---

### Empty State Copy Inventory

| Section | Empty State Heading | Empty State Body (Problem + Next Step) | Contextual Action |
|---------|---------------------|----------------------------------------|-------------------|
| **Diagnosis Table** | No diagnoses recorded | Tap a quick condition chip above or search ICD-11 / SNOMED CT terminology to add a diagnosis. | Focused search input |
| **Prescription Builder** | No medications prescribed | Search the India CDCI medicine master or select a protocol template to prescribe medications. | `[⚡ Repeat Last Rx]` |
| **Investigations Advised** | No investigations advised | Select common test chips (CBC, Blood Sugar) or type custom investigations for lab routing. | None |
| **Diet & Clinical Advice** | No advice added | Tap common lifestyle chips (Warm saline gargle, Plenty of fluids) or enter specific instructions. | None |
| **History Drawer** | No previous visits found | This patient has no past visits recorded at this clinic. Future visits will appear here chronologically. | None |
| **Clinical Attachments** | No clinical files attached | Drag and drop previous lab reports, prescriptions, or imaging (JPEG, PNG, PDF up to 10MB). | `[Upload Clinical File]` |
| **Dental Summary Table** | No dental findings marked | Click any tooth in the chart above to tag conditions such as caries, crowns, or extractions. | None |

---

### Error State Copy Inventory

| Scenario | User-Facing Error Message | Solution Path Provided |
|----------|---------------------------|------------------------|
| **Vitals Validation** | Systolic BP must be greater than Diastolic BP. | Please check the blood pressure values entered and correct the readings. |
| **Vitals Out of Range** | Temperature must be between 90°F and 110°F. | Enter a realistic body temperature reading or clear the field. |
| **Empty Medicine Name** | Medicine name cannot be empty. | Select a valid medicine from the search results or type a custom drug name. |
| **Missing Dosage** | Frequency and duration are required for all medicines. | Select a frequency chip (e.g. 1-0-1) and a duration (e.g. 5 days). |
| **CDCI Drug Search Failed** | Unable to search drug database. | Check your clinic internet connection and retry typing your search query. |
| **PDF Generation Failed** | Could not generate prescription PDF. | The server encountered an error compiling the PDF. Click "Retry Generation" or save draft. |
| **Missing Amendment Reason** | Amendment reason is required. | Provide a brief clinical reason for modifying this already finalized consultation. |
| **File Size Limit Exceeded** | File exceeds maximum size of 10MB. | Please select an image or PDF under 10MB in size. |
| **Unsupported File Format** | Unsupported file format. | Only JPEG, PNG, and PDF files are supported for clinical record uploads. |

---

### Destructive & Irreversible Confirmations

| Action | Modal Title | Confirmation Copy | Safe Button | Destructive Button |
|--------|-------------|-------------------|-------------|--------------------|
| **Remove Medication** | Remove Medication | Are you sure you want to remove **{medicine_name}** from this prescription? | `Keep Medication` | `Remove Medication` (`danger`) |
| **Clear Tooth Conditions** | Clear Tooth Conditions | Are you sure you want to clear all marked findings for **Tooth #{tooth_number}**? | `Keep Tooth Conditions` | `Clear Tooth` (`danger`) |
| **Discard Draft Consultation** | Discard Consultation Draft | All unsaved clinical notes and prescription items for this visit will be discarded. This cannot be undone. | `Continue Editing` | `Discard Draft` (`danger`) |
| **Complete Visit without Rx** | Complete without Prescription | You have not added any medications to this visit. Do you want to complete this consultation without a prescription? | `Add Prescription` | `Complete Without Rx` (`secondary`) |

---

## UI Considerations (State Coverage Matrix)

Populated for Phase 03 consultation workflows across the 8 standard UI states:

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| **Empty** | Diagnoses Table | ✅ covered | Renders documented empty state with quick chips and active search prompt. |
| **Empty** | Prescription Builder | ✅ covered | Renders empty state with "Repeat Last Rx" and "Protocol Templates" quick triggers. |
| **Empty** | History Drawer | ✅ covered | Displays calm zero-history illustration and explains this is the first clinic visit. |
| **Loading** | CDCI Drug Search | ✅ covered | Inline spinning indicator in search field; retains previous results until query resolves in <100ms. |
| **Loading** | PDF Preview Modal | ✅ covered | Skeleton document container with centered spinner and `"Compiling clinical letterhead..."`. |
| **Loading** | Complete & Sign Action | ✅ covered | Button displays spinner with `"Finalizing & Signing..."`, disabling double-clicks. |
| **Error** | Network Disconnect during Auto-Save | ✅ covered | Header displays persistent amber tag `"Offline — changes saved locally in browser"`. |
| **Error** | PDF Generation Failure | ✅ covered | Renders retry banner inside preview modal with actionable `"Retry Generation"` button. |
| **Populated** | 10+ Medication Rows | ✅ covered | Scrollable prescription container with sticky sub-headers and compact row layout. |
| **Partial** | Vitals (Nurse entered BP only) | ✅ covered | Renders BP with nurse timestamp; remaining vitals display clean dash placeholders with inline edit affordance. |
| **Overflow** | Long Medicine Names (e.g. Amoxicillin + Potassium Clavulanate + Lactic Acid Bacillus) | ✅ covered | Wraps gracefully onto two lines; dosage chips remain right-aligned on desktop and stack below on mobile. |
| **Long-text** | Clinical Notes / HPI | 🧪 backstop | Textarea auto-expands with minimum 96px height; preserves line breaks on generated PDF. |
| **Zero-one-many** | Patient Allergies | ✅ covered | 0 allergies: Banner hidden. 1-2 allergies: Single-line badge row. 3+ allergies: Multi-chip list with warning accent. |
| **Mobile Breakpoint** | Odontogram Tooth Chart | 🧪 backstop | Horizontally scrollable quadrant container (`overflow-x-auto`) with minimum 44px touch targets. |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | None | Not applicable (Custom Tailwind v4 components adhering to `DESIGN.md`) |
| TailAdmin Free | UI Layout & Component Patterns (`components/ui/`, `components/layout/`) | Canonicalized in Phase 02.1 / Phase 2B. All tokens mapped in `app/globals.css`. |
| `@react-pdf/renderer` | Server-Side PDF Engine (`v4.1.0+`) | Server-side only via `next.config.ts` (`serverExternalPackages`). Never imported into client bundle. |

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS — Explicit verb + noun buttons (`Complete & Sign ℞`, `Cancel Amendment`, `Keep Tooth Conditions`, `Close Preview`, `Open Patient History`, `Edit Vitals`), zero generic labels, complete empty states with problem + next step, human-friendly error messages, clear confirmations.
- [x] Dimension 2 Visuals: PASS — Clear primary visual focal point (`Complete & Sign ℞` + active Rx Builder), explicit accessible `aria-label` fallbacks for all icon-only buttons (`aria-label="Remove diagnosis"`, `aria-label="Dismiss complaint"`, `aria-label="Remove medication"`, `aria-label="Close modal"`, `aria-label="Close patient history drawer"`, `aria-label="Close preview"`, `aria-label="Edit vitals"`), single-page fast SOAP layout, interactive SVG odontogram, pediatric WHO percentiles & IAP checklists, dual letterhead PDF preview modal, history drawer.
- [x] Dimension 3 Color: PASS — Strictly light theme, `#1769E0` accent reserved for primary actions, `#F7F6F3` canvas, dental condition palette mapped, zero dark surfaces.
- [x] Dimension 4 Typography: PASS — Inter font, consolidated to strictly 4 font sizes (24px Display, 18px Heading, 14px Body, 12px Caption/Label) and strictly 2 font weights (400 Regular, 600 Semibold). Weight 500 removed.
- [x] Dimension 5 Spacing: PASS — Strict multiples of 4 (4px to 64px, zero 6px odd values), 44px mobile touch targets enforced for all interactive controls.
- [x] Dimension 6 Registry Safety: PASS — Tailwind v4 `@theme` tokens, TailAdmin architecture, server-only `@react-pdf/renderer`.
- [x] Dimension 7 Inventory Provenance: PASS — Exact enumeration of 11 `components/ui/` files with package versions and import paths.

**Approval:** Approved 2026-10-11
