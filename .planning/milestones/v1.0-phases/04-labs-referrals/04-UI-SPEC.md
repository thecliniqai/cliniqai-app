---
phase: "4"
slug: "labs-referrals"
status: approved
shadcn_initialized: false
preset: none
created: "2026-10-22"
---

# Phase 4 — UI Design Contract

> Visual and interaction contract for Phase 4: Labs & Referrals.
> Single source of truth for spacing, typography, color, copywriting, and component interaction.
> Strictly adheres to DESIGN.md canonical light theme tokens and TailAdmin design language.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | custom TailAdmin / Radix primitives |
| Preset | light-only canonical |
| Component library | custom `components/ui/` (`alert`, `badge`, `button`, `card`, `dropdown`, `empty-state`, `field`, `input`, `modal`, `select`, `table`) |
| Icon library | `lucide-react` |
| Font | `Inter` (sans-serif) |

---

## Component Inventory

Enumerated from `components/ui/` — 11 primitives — 2026-10-22.

| Component | Import Path | Notes |
|-----------|-------------|-------|
| `Alert` | `@/components/ui/alert` | For warning messages, soft-blocks, and upload errors |
| `Badge` | `@/components/ui/badge` | For status (`sent`, `acknowledged`, `completed`), urgency, and file type badges |
| `Button` | `@/components/ui/button` | For primary CTAs (`#1769E0`), secondary actions, and icon buttons |
| `Card` | `@/components/ui/card` | For containment in Patient Profile and Referrals summary |
| `Dropdown` | `@/components/ui/dropdown` | For table row overflow actions |
| `EmptyState` | `@/components/ui/empty-state` | For zero-record states in tables and tabs |
| `Field` | `@/components/ui/field` | Form field wrapper with label, error text, and hint |
| `Input` | `@/components/ui/input` | Text and date inputs with 40px height and 8px border radius |
| `Modal` | `@/components/ui/modal` | For upload drawers, referral creation, and close-the-loop dialogs |
| `Select` | `@/components/ui/select` | For specialty, urgency, and letterhead selection |
| `Table` | `@/components/ui/table` | For document lists and referrals register |

---

## Spacing Scale

Declared values (strictly multiples of 4, per DESIGN.md §6):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon gaps, inline tag padding, status dot spacing |
| sm | 8px | Compact element spacing, input-to-label gaps, badge padding |
| md | 16px | Default container padding, table cell padding, card body |
| lg | 24px | Modal body padding, section padding, grid column gaps |
| xl | 32px | Page header spacing, large modal margins |
| 2xl | 48px | Major dashboard section breaks |
| 3xl | 64px | Page-level bottom clearance on mobile |

Exceptions: none.

---

## Typography

Strictly follows DESIGN.md §7:

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Display | 24px | 700 (Bold) | 1.2 (28px) |
| Heading (Section/Modal) | 18px | 600 (Semibold) | 1.3 (24px) |
| Subheading (Card/Tab) | 16px | 600 (Semibold) | 1.4 (22px) |
| Body / Form Text | 14px | 400 (Regular) | 1.5 (20px) |
| Label / Button Text | 14px | 500 / 600 | 1.4 (20px) |
| Caption / Help Text | 12px | 400 (Regular) | 1.4 (16px) |
| Badge / Tag Text | 12px | 600 (Semibold) | 1.0 (12px) |

---

## Color

Strictly follows DESIGN.md §5 (Light theme only, no dark shells, no decorative gradients):

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#FFFFFF` / `#F8F9FA` | Main page background, card surfaces, table rows |
| Secondary (30%) | `#F1F2F4` / `#E4E5E7` | Table borders, divider lines, subtle backgrounds, inactive tabs |
| Accent (10%) | `#1769E0` | Primary buttons, active tabs, links, focus rings, selected badges |
| Text Primary | `#17181A` | Headings, patient names, table primary text |
| Text Secondary | `#52565B` | Labels, dates, doctor notes, secondary descriptors |
| Text Tertiary | `#73777D` | Timestamps, file size hints, placeholder text |
| Semantic Info | `#1769E0` text / `#EAF2FF` bg / `#BFD8FF` border | Status `Acknowledged`, Inbound referral, share link info |
| Semantic Warning | `#9A5B00` text / `#FFF5E5` bg / `#F3D39A` border | Status `Sent`, Priority urgency, expiring link notice |
| Semantic Success | `#18794E` text / `#EAF7F0` bg / `#BDE5CF` border | Status `Completed`, successful upload, copied link confirmation |
| Semantic Danger | `#BA1A1A` text / `#FFEDEC` bg / `#F2B8B5` border | Urgent referral, delete document action, upload failure |

Accent reserved for: Primary action buttons (`Upload Report`, `Create Referral`, `Save & Complete`), active navigation indicator, tab active underline, and focus outlines.

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Primary CTA (Upload) | `Upload Lab Report` |
| Primary CTA (Referral) | `Create Referral` |
| Primary CTA (Loop Closure) | `Close the Loop` |
| Primary CTA (Complete) | `Save & Complete Referral` |
| Empty state heading (Labs) | `No lab reports uploaded yet` |
| Empty state body (Labs) | `Upload diagnostic lab results, imaging scans, and partner reports for this patient.` |
| Empty state heading (Referrals) | `No referrals recorded` |
| Empty state body (Referrals) | `When you refer patients to external specialists or partner clinics, they will appear here.` |
| Error state (Upload size) | `File exceeds the 10 MB limit. Please select a smaller PDF or image.` |
| Error state (Network error) | `Unable to save referral. Please check your connection and try again.` |
| Destructive confirmation | `Delete Document: Are you sure you want to delete this lab report? This action cannot be undone.` |
| DPDP Consent Checkbox | `Patient consents to share medical history summary (diagnoses, medications, vitals) with the receiving clinician.` |

---

## Screen & Interaction Specifications

### 1. Patient Profile — "Lab Reports & Records" Tab (`/patients/[id]`)
- Rendered as a dedicated tab alongside "Visits" in the patient profile.
- Tab Header: `Lab Reports & Records` with a numerical badge `(N)`.
- Action Bar: `Upload Lab Report` primary button with `Upload` icon.
- Document Table:
  - Columns: File Name (sanitized `[Patient]_[Title]_[Date].ext`), Date, Size/Type, Uploaded By, Actions.
  - Row Actions: `Download` icon, `Share Link` icon (opens share modal), `Delete` icon button (with confirmation).
- Upload Modal:
  - Drag-and-drop file target (accepts `.pdf`, `.jpg`, `.jpeg`, `.png`, max 10MB).
  - Inputs: Document Title (e.g. "Lipid Profile & HbA1c"), Report Date (date picker, defaults to today), Clinical Notes (optional textarea).
  - CTAs: `Cancel` (ghost) and `Upload & Attach` (primary `#1769E0`).

### 2. Consultation Cabin — Lab & Referral Triggers (`/consultation/[id]`)
- Located under Treatment / Disposition section:
  - **Recommended Lab Tests:**
    - Fast multi-chip selector for common tests (`CBC`, `HbA1c`, `Lipid Profile`, `LFT`, `KFT`, `Thyroid (T3/T4/TSH)`, `Urine R/M`).
    - Inline text input for custom test addition.
    - Tests automatically print on the generated prescription / investigation requisition.
  - **Referral Action:**
    - Secondary button: `Refer Patient` with `Share2` icon opens referral creation modal.

### 3. Referral Creation Modal (`create-referral-modal.tsx`)
- Tab toggle: `Out-of-Network Specialist` | `In-Network Partner`.
- Out-of-Network fields:
  - Specialist / Clinician Name (required text input)
  - Hospital / Clinic / Facility (text input)
  - Specialty (dropdown: Cardiology, Orthopedics, Dermatology, ENT, Pediatrics, General Surgery, Gynecology, Neurology, Oncology, Other)
  - Urgency (segmented picker: `Routine`, `Priority`, `Urgent`)
  - Reason for Referral (textarea, required)
  - Letterhead Mode: `Blank Paper (Full Clinic Header)` vs `Pre-printed Stationery (Margin Gap)`
- In-Network fields:
  - Target Doctor / Partner Clinic dropdown
  - Reason & Urgency
  - DPDP Consent Checkbox: Required before submission.
- Primary CTA: `Issue Referral & Generate Letter`.

### 4. Clinic Referrals Register (`/referrals`)
- Accessible from main sidebar between `Visits` and `Billing` with `Share2` icon.
- Tabs: `Outbound Referrals` (default) | `Inbound Referrals`.
- Filter Toolbar:
  - Search input (searches patient name, UHID, receiving specialist).
  - Status Filter: `All`, `Sent`, `Acknowledged`, `Completed`.
  - Urgency Filter: `All`, `Routine`, `Priority`, `Urgent`.
- Table Columns:
  - Patient (Avatar + Name linked to `/patients/[id]`, Age/Sex, UHID)
  - Referred To (Doctor & Clinic, Specialty badge)
  - Reason for Referral (text snippet with tooltip)
  - Urgency Badge (`Routine`: neutral gray, `Priority`: amber, `Urgent`: red)
  - Date Sent
  - Status Badge (`Sent`: amber, `Acknowledged`: blue, `Completed`: green)
  - Actions: `View Letter` (PDF download), `Close the Loop` button.
- "Close the Loop" Modal:
  - Title: `Close Referral Loop — [Patient Name]`
  - Fields: Return Date (default today), Specialist Findings / Follow-up Plan (textarea, required).
  - CTA: `Mark as Completed & Save Notes`.

### 5. Public Tokenized Document Viewer (`/reports/view?token=...`)
- Mobile-first, standalone public view without app navigation shell.
- Header: Clinic Name, Verification Shield icon (`"Verified Clinical Record"`).
- Document Card:
  - Document Title, Patient Name, Date, Ordering Doctor.
  - Embedded PDF preview / image viewer.
  - `Download PDF` button.
  - Expiry notice: `"This secure link is valid until [Date]"` with clinic support contact.

---

## UI Considerations

Applicable state considerations resolved: 8 covered, 0 backstop, 0 unresolved

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| empty | Lab Documents Table | ✅ covered | Renders `EmptyState` component with document icon and `Upload Lab Report` CTA |
| empty | Referrals Register | ✅ covered | Renders `EmptyState` with `Share2` icon and descriptive subtitle |
| loading | Document Upload | ✅ covered | Upload button displays spinner with `"Uploading & encrypting..."` disabled state |
| loading | PDF Referral Generation | ✅ covered | Button displays `"Generating PDF..."` with spinner |
| error | Upload file too large / invalid type | ✅ covered | Inline alert banner `#FFEDEC` with specific constraint guidance |
| error | Referral creation failure | ✅ covered | Toast / Alert displaying user-friendly error message |
| overflow | Referral Notes & Specialist Names | ✅ covered | Table cells truncate with ellipsis and provide full text on hover tooltip |
| mobile | Referrals Register on small screens | ✅ covered | Responsive table collapses to card-based rows on screens < 768px |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| custom project primitives | `components/ui/` | not required (all native Tailwind & Lucide) |

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS
- [x] Dimension 2 Visuals: PASS
- [x] Dimension 3 Color: PASS
- [x] Dimension 4 Typography: PASS
- [x] Dimension 5 Spacing: PASS
- [x] Dimension 6 Registry Safety: PASS
- [x] Dimension 7 Inventory Provenance: PASS

**Approval:** approved 2026-10-22
