# Plan 03-02 Summary: Consultation Workspace & Specialty Templates

## Execution Overview
- **Phase:** 03 (Consultation & Prescribing)
- **Plan:** 03-02 (Consultation Workspace & Specialty Templates)
- **Status:** Completed
- **Branch:** `phase-2b-tailadmin-ui`
- **Verification:**
  - `npx vitest run tests/consultation/schemas.spec.ts tests/dental/odontogram.spec.ts tests/pediatrics/who-growth.spec.ts` (25/25 passed)
  - `npm run typecheck` (0 errors across whole repository)

---

## Deliverables & Key Implementations

### 1. Zod Validation & Server Actions (`features/consultation/`)
- `features/consultation/schema.ts`:
  - `vitalsSchema`: Physiologic bounds for 8 vital metrics with systolic > diastolic validation.
  - `chiefComplaintItemSchema`: Symptom name, duration (val + unit: days/weeks/months/years), and clinical notes.
  - `specialtyDataSchema`: Discriminated union for `general_physician`, `dental`, and `pediatrics`.
  - `dentalToothSchema`: FDI Two-Digit Notation (adult 11-48, deciduous 51-85) with condition tags (`decay`, `crown`, `missing`, `rct`, `filled`, `extraction`).
  - `pediatricsSpecialtySchema`: Birth history (gestational age, birth weight, delivery type, complications), head circumference, and administered immunizations array.
  - `followUpSchema`: Recommendation intervals (`3_days`, `5_days`, `1_week`, `2_weeks`, `custom`), target date, and instructions.
  - `saveConsultationDraftSchema`: Complete consultation draft payload.
- `features/consultation/actions.ts`:
  - `saveConsultationDraft`: Server action saving draft SOAP sections to `visits` table, transitioning status from `waiting` to `in_consultation`, upserting `follow_ups`, and recording audit events.
  - `recordFollowUp`: Upserts follow-up recommendations with tenant isolation.
  - `getPatientConsultationHistory`: Fetches chronological timeline of past visits, diagnoses, and prescriptions for the slide-over drawer.
- `lib/audit/audit.ts`:
  - Updated whitelist to permit `consultation.draft_save`, `follow_up.record`, and metadata keys (`specialty`, `complaints_count`, `has_vitals`, `follow_up_date`).

### 2. Core Consultation Workspace Components (`components/consultation/`)
- `components/consultation/vitals-block.tsx`:
  - 7-vital responsive grid (BP, Pulse, SpO2, Temp, Weight, Height, BMI).
  - Auto-calculates BMI from weight and height in real time.
  - Abnormal badges: High BP (`>=140/90`), Low BP (`<90/60`), Low SpO2 (`<95%`), Fever (`>99.5°F`), High Fever (`>102°F`), BMI categories.
  - Inline editing with `[Edit Vitals]` button and nurse attribution timestamp.
- `components/consultation/chief-complaints-section.tsx`:
  - 1-tap quick OPD symptom chips (Fever, Cough, Headache, Cold, Vomiting, Loose Stools, etc.).
  - Duration picker chips (1d, 2d, 3d, 5d, 1w, 2w) + custom duration input.
  - Auto-expanding clinical notes textarea.
- `components/consultation/patient-history-drawer.tsx`:
  - Slide-over fixed right drawer with backdrop blur.
  - Timeline of previous visits displaying diagnoses and prescriptions.
  - 1-click `[Repeat this Rx]` and `[Copy Notes]` callbacks.

### 3. Specialty Templates Layer (`components/consultation/specialty/` & `lib/pediatrics/`)
- `components/consultation/specialty/gp-systemic-review.tsx`:
  - General physical examination checklist: PICCLE (Pallor, Icterus, Cyanosis, Clubbing, Lymphadenopathy, Edema) toggles with amber warning states.
  - Systemic review textareas: CVS, RS, PA, CNS with clinical placeholders.
- `components/consultation/specialty/dental-odontogram.tsx`:
  - Declarative SVG odontogram using standard FDI Two-Digit Notation.
  - Segmented control toggling between Adult (32 teeth) and Deciduous (20 teeth).
  - Quadrant layouts (Maxillary Upper Right 18-11 / 55-51, Upper Left 21-28 / 61-65; Mandibular Lower Right 48-41 / 85-81, Lower Left 31-38 / 71-75) with visual midline.
  - Interactive condition popover: Decay (`#EF4444`), Crown (`#F59E0B`), Missing (`#64748B`), RCT (`#A855F7`), Filled (`#3B82F6`), Extraction (`#991B1B`).
  - Flagged teeth summary table with remove action and general dental notes.
- `lib/pediatrics/who-data.ts`:
  - High-precision error function (`erf`) and standard normal CDF (`normalCdf`).
  - WHO Child Growth LMS Tables (0-60 months) for Weight-for-age, Height-for-age, and Head Circumference-for-age.
  - Exact closed-form LMS Z-score formula: $Z = \frac{(X/M)^L - 1}{L \cdot S}$.
  - Indian Academy of Pediatrics (IAP) 12-milestone immunization checklist schedule.
- `components/consultation/specialty/pediatrics-tools.tsx`:
  - Birth history fields (Gestational age, birth weight, delivery method, complications).
  - Real-time WHO growth percentile calculator with colored badges (<3rd, 3rd-15th, 15th-85th, 85th-97th, >97th).
  - IAP ACVIP vaccine checklist accordion with status pills (Given, Due).

### 4. Main Consultation Workspace Route (`app/(dashboard)/consultation/[id]/page.tsx`)
- Server component resolving visit, patient demographics, token number, past encounters, and follow-up data.
- Enforces user authentication and tenant boundary via `getActiveMembership()`.
- Renders `ConsultationWorkspace` (`components/consultation/consultation-workspace.tsx`):
  - Sticky top workspace header with back link, patient demographics, specialty dropdown, auto-save status indicator, manual save draft, and `Complete & Sign ℞` button.
  - Sticky 44px section jump bar (`#vitals`, `#complaints`, `#examination`, `#diagnosis`, `#prescription`, `#investigations`, `#follow-up`).
  - Known patient allergy warning banner.
  - 15-second debounced auto-save hook syncing draft to server without blocking typing.
  - Investigations advised quick chips + custom test entry.
  - Diet and lifestyle advice quick chips + free-text advice.
  - Follow-up recommendation selector chips (`3 Days`, `5 Days`, `1 Week`, `2 Weeks`, `Custom Date`) with calendar picker.
  - Clinical attachments dropzone for JPEG/PNG/PDF reports.

---

## Automated Verification Results
- `tests/consultation/schemas.spec.ts`: 11 tests passed.
- `tests/dental/odontogram.spec.ts`: 7 tests passed (FDI numbering, deciduous vs adult, condition tags, serialization).
- `tests/pediatrics/who-growth.spec.ts`: 7 tests passed (LMS Z-score formula, normal 50th percentile, <3rd percentile stunting, normal CDF).
- `npm run typecheck`: 0 TypeScript compilation errors.

---

## Atomic Commits
1. `eb1845b`: `feat(03-02): consultation server actions, zod schemas, and unit tests` (Task 1)
2. `f2837e8`: `feat(03-02): vitals block, chief complaints chips, and patient history drawer` (Task 2)
3. `183ca94`: `feat(03-02): specialty templates for gp, dental odontogram, and pediatrics tools` (Task 3)
4. `e2f3db2`: `feat(03-02): main consultation workspace page with sticky jump bar and auto-save` (Task 4)
