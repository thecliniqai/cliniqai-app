---
phase: "05"
slug: "communications-ai-assist"
status: approved
shadcn_initialized: false
preset: none
created: "2026-10-26"
---

# Phase 05 — UI Design Contract: Communications & AI Assist

> Visual and interaction contract for frontend components in Phase 5.
> Authoritative guide for layout, tokens, typography, component interactions, and state handling.
> Single source of visual truth: `DESIGN.md` (Light theme only, Inter font, #1769E0 brand primary).

---

## Design System

| Property | Value | Notes |
|----------|-------|-------|
| Tool | none | Native Tailwind CSS v4 + React 19 + Lucide Icons |
| Preset | not applicable | Custom design tokens defined in `DESIGN.md` |
| Component library | custom | Standardized accessible primitives in `components/ui/` |
| Icon library | lucide-react | Standard icons: `Bell`, `Sparkles`, `Mic`, `Bot`, `Share2`, `Clock`, `CheckCheck`, `AlertCircle` |
| Font | Inter (Google Fonts / `next/font/google`) | 400 (Regular), 500 (Medium), 600 (Semi-Bold), 700 (Bold) |

---

## Component Inventory

Could not enumerate: Project uses custom Tailwind component architecture (`components/ui/`) without shadcn CLI.

| Component | Import Path | Usage in Phase 5 |
|-----------|-------------|-------------------|
| `Button` | `@/components/ui/button` | Primary actions ("Accept & Insert", "Share via WhatsApp", "Generate Draft"), secondary dismiss/cancel |
| `Modal` | `@/components/ui/modal` | AI Dictation / Scribe modal, WhatsApp Resend dialog |
| `Badge` | `@/components/ui/badge` | AI-suggested indicators (`✦ AI Suggested`), notification categories, delivery status pills |
| `Card` | `@/components/ui/card` | Notification drawer items, AI SOAP preview sections, Catch-Up summary card |
| `EmptyState` | `@/components/ui/empty-state` | Notification drawer zero-state ("All caught up"), empty outbox queue |
| `Alert` | `@/components/ui/alert` | In-app notification alerts, quota threshold banners, token expired warnings |
| `Input` | `@/components/ui/input` | Notification search/filter, custom template parameters |
| `Dropdown` | `@/components/ui/dropdown` | Notification item quick-actions menu ("Mark as read", "Go to record") |

---

## Spacing Scale

Declared values (strictly multiples of 4, conforming to `DESIGN.md` §6):

| Token | Value | Usage in Phase 5 |
|-------|-------|-------------------|
| xs | 4px | Gaps between icons and text pills, micro badges (`gap-1`, `p-1`) |
| sm | 8px | Gap between notification list items, pill padding, chip tags (`gap-2`, `p-2`) |
| md | 16px | Notification drawer padding, modal body padding, card gutters (`p-4`, `space-y-4`) |
| lg | 24px | Section separation in Consultation Cabin, Catch-Up banner margin (`p-6`, `mb-6`) |
| xl | 32px | Drawer header separation, empty state vertical breathing room (`py-8`) |
| 2xl | 48px | Public mobile report viewer top/bottom canvas padding (`py-12`) |
| 3xl | 64px | Page-level boundaries (`py-16`) |

**Exceptions:** 44px minimum touch target height on all mobile buttons and drawer action links per WCAG 2.2 AA.

---

## Typography

Strictly limited to 4 sizes and 2 weights (Regular 400 and Semi-Bold 600), matching `DESIGN.md` §4:

| Role | Size | Weight | Line Height | Usage in Phase 5 |
|------|------|--------|-------------|-------------------|
| Body | 14px (`text-sm`) | 400 (`font-normal`) | 1.5 (`leading-relaxed`) | Notification descriptions, AI SOAP generated notes, message logs, public viewer body |
| Label / Micro | 12px (`text-xs`) | 500 / 600 (`font-medium` / `font-semibold`) | 1.3 (`leading-tight`) | Notification timestamps ("2m ago"), `✦ AI Suggested` badge text, status pills, table headers |
| Heading | 18px (`text-lg`) | 600 (`font-semibold`) | 1.25 (`leading-snug`) | Notification drawer title, AI Scribe modal header, Catch-Up card heading |
| Display | 24px (`text-2xl`)| 700 (`font-bold`) | 1.2 (`leading-tight`) | Public patient document preview title ("Your Prescription") |

---

## Color

Conforms strictly to `DESIGN.md` §5 (60% Dominant / 30% Secondary / 10% Accent, Light Theme Only):

| Role | Value | Token / Class | Usage in Phase 5 |
|------|-------|---------------|-------------------|
| Dominant (60%) | `#F7F6F3` / `#FFFFFF` | `bg-[#F7F6F3]`, `bg-white` | Application canvas, drawer surface, modal background |
| Secondary (30%) | `#FFFFFF` / `#ECEEF0` | `bg-white`, `border-[#E4E5E7]`, `text-[#52565B]` | Notification item containers, divider rules, subtle backgrounds |
| Primary Accent (10%) | `#1769E0` | `bg-[#1769E0]`, `text-[#1769E0]` | Primary action buttons ("Accept & Insert", "Send WhatsApp"), active notification tabs |
| Primary Hover | `#0F5AB8` | `hover:bg-[#0F5AB8]` | Hover state for primary buttons |
| Primary Soft | `#EAF2FF` | `bg-[#EAF2FF]`, `text-[#1769E0]` | Active tab background, selected notification highlight |
| AI Semantic Accent | `#6366F1` / `#4F46E5` | `bg-indigo-50`, `border-indigo-200`, `text-indigo-700` | AI-generated labels (`✦ AI Suggested`), Catch-Up summary border, Scribe wand icon |
| Success Semantic | `#16A34A` | `bg-emerald-50`, `text-emerald-700`, `border-emerald-200` | Delivered message pills, WhatsApp connected state, appointment confirmed |
| Warning Semantic | `#D97706` | `bg-amber-50`, `text-amber-700`, `border-amber-200` | Quota 80% warning, schedule conflict alert, retry in progress |
| Destructive Semantic | `#DC2626` | `bg-rose-50`, `text-rose-700`, `border-rose-200` | Quota exhausted, message delivery failed, cancel appointment button |

**Accent Reserved For:**
1. Primary submit buttons ("Accept & Insert", "Share via WhatsApp", "Generate Draft").
2. Active tab indicator in the Notification Drawer.
3. Unread notification dot badge on the top-nav Bell icon.
4. Interactive text links in patient records and notifications.

*(Never used for decorative container borders or non-interactive headings).*

---

## Surface Contracts

### 1. In-App Notification Center (`components/layout/app-header.tsx` & `components/notifications/`)

- **Top-Nav Trigger:**
  - Placed in `AppHeader` between Global Search and User Profile dropdown.
  - 40x40px icon button (`p-2 rounded-lg hover:bg-gray-100 text-[#52565B]`).
  - Unread Badge: 18x18px pill over top-right corner with count (e.g. `3`), `bg-red-500 text-white font-bold text-[10px]`. Hidden when unread count is 0.
- **Slide-Over Notification Drawer:**
  - Width: 380px on desktop (`max-w-md`), full-width on mobile (`w-full`).
  - Drops from right edge with subtle backdrop overlay (`bg-black/20 backdrop-blur-xs`).
  - Header: Sticky top bar with "Notifications", unread count pill, "Mark all as read" ghost button (`text-xs text-[#1769E0] hover:underline`), and Close (`X`) button.
  - Filter Tabs: `[ All ]` and `[ Action Needed ]` (inbound WhatsApp replies, waitlist openings).
  - Notification Item Layout:
    - 3-column row: Category Icon (40x40px soft circle: green for WhatsApp reply, blue for patient arrival, amber for waitlist), Content block (Title in `font-medium text-sm text-[#17181A]`, snippet in `text-xs text-[#52565B]`, timestamp `text-[11px] text-gray-400`), Unread indicator (8px blue dot).
    - Quick Action Button: Inline small button on actionable notifications (`Assign Waitlist`, `View Reply`, `Open Visit`).
    - Click Behavior: Clicking an item marks it as read and deep-links directly to the relevant record (`/queue`, `/patients/[id]`, `/calendar`).

### 2. Consultation Cabin: AI Dictation / Quick Scribe (`components/consultation/`)

- **Trigger:**
  - A prominent pill button in the Consultation Cabin toolbar: `[ ✦ AI Quick Scribe ]` (`bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 font-medium text-xs py-1.5 px-3 rounded-lg flex items-center gap-1.5`).
- **Scribe Modal / Drawer:**
  - Header: "AI Clinical Scribe — Shorthand & Dictation" with subtitle "Dictate or paste shorthand. Clinical note draft requires doctor acceptance before insertion."
  - Input Section:
    - Textarea with 4-line height for raw shorthand.
    - Speech-to-Text Button: Mic icon `[ Start Dictation ]`. When listening: switches to `[ ⏹ Recording... ]` with red pulse ring (`animate-pulse bg-red-100 text-red-600`).
  - Action: "Generate SOAP Draft" (`bg-[#1769E0] text-white`).
  - Preview Card:
    - Visible header: `✦ AI Suggested Draft` (`bg-indigo-50/70 border border-indigo-200 rounded-lg p-3.5`).
    - Displays structured parsed sections:
      - **Chief Complaints:** Extracted complaints + duration chips.
      - **Examination:** Physical observations.
      - **Diagnosis:** Provisional diagnosis code/name.
      - **Prescription:** Suggested medicines with dose and frequency.
      - **Advice:** Patient lifestyle instructions.
  - Acceptance Footer:
    - `[ Accept & Insert into Note ]` (Primary blue `#1769E0` button — copies draft fields into active consultation without overwriting existing entries).
    - `[ Discard ]` (Secondary button).
  - Safety Indicator: Prominent label on inserted fields: *"AI-suggested content. Edit or verify before signing."*

### 3. Consultation Header: Returning Patient Catch-Up Summary

- **Trigger & Placement:**
  - Directly beneath the patient header in the Consultation Cabin when `visit_count > 1`.
  - Initial State: Compact 1-line amber/indigo card:
    `✦ Returning Patient (3 previous visits) — Last seen 14 days ago for Fever. [ Generate AI Catch-Up ]`
- **Expanded State (On-Demand):**
  - Generates in <1 second:
    - Bullet 1: **Last Visit Summary:** Diagnosis and clinical outcome.
    - Bullet 2: **Current Medications:** Active prescriptions list.
    - Bullet 3: **Alerts / Chronic:** Known allergies and chronic conditions.
  - Action: `[ Close Summary ]` toggle.

### 4. Prescription Builder: Historical Doctor Suggestion Chips

- **Placement:** Directly below the Diagnosis selection field in `prescription-builder.tsx`.
- **Layout:** Horizontal scrollable chip bar with subtle label: `Frequently Prescribed by You:`.
- **Chip Style:**
  - `[ + Azithromycin 500mg (1-0-0, 3d) ]` (`bg-slate-100 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 text-xs px-2.5 py-1 rounded-full border border-gray-200 transition-colors`).
- **Interaction:**
  - Clicking a chip immediately appends the medication to the current prescription table.
  - A momentary green check icon confirms insertion.

### 5. Public Mobile Document Viewer (`/r/[token]`)

- **Layout:** Standalone mobile-optimized page (no clinic internal sidebar or app header).
- **Canvas:** Clean daylight canvas (`bg-[#F7F6F3]`). Max container width: 480px centered.
- **Header:**
  - Clinic Name in bold (`text-lg font-bold text-[#17181A]`), Doctor Name, Clinic Address, and a quick `[ 📞 Call Clinic ]` tel link.
- **Document Card:**
  - Card container (`bg-white rounded-xl shadow-xs border border-[#E4E5E7] p-5`).
  - Document Title: e.g. "Prescription — Rajesh Kumar".
  - Issued Date: "Issued on 26 Oct 2026 by Dr. A. Sharma".
  - PDF Viewer / Actions:
    - Primary Button: `[ 📥 Download Official PDF ]` (`bg-[#1769E0] text-white w-full py-3 rounded-lg font-semibold text-sm`).
    - Secondary: In-browser PDF preview iframe with mobile pinch-zoom support.
- **Security & Expiry State:**
  - Footer badge: *"Secure official document issued via CliniQ AI. Link expires in 7 days."*
  - Expired State: When token is expired or revoked, shows an `Alert` (`bg-amber-50 border-amber-200 text-amber-900`): *"This document link has expired for patient security. Please call the clinic at +91-XXXXX to request a new link."*

---

## Copywriting Contract

| Element | Copy | Notes |
|---------|------|-------|
| Primary CTA (Consultation AI Scribe) | "Accept & Insert into Note" | Specific verb + noun, unambiguous non-destructive action |
| Primary CTA (Patient Document Viewer) | "Download Official PDF" | Clear, reassuring patient mobile action |
| Primary CTA (WhatsApp Share) | "Share via WhatsApp" | Staff-triggered digital delivery |
| Notification Drawer Empty State | Heading: "All caught up" <br> Body: "You have no unread notifications or pending patient replies." | Reassuring, calm clinic status |
| Outbox Queue Zero-State | Heading: "Outbox is clear" <br> Body: "All queued WhatsApp and SMS messages have been successfully dispatched." | Operational confidence |
| Message Quota Warning (80%) | Heading: "Monthly Message Limit Warning" <br> Body: "Your clinic has used 82% of its monthly messaging quota (820 / 1000 messages). High-volume alerts will remain in-app." | Factual, actionable |
| Message Quota Exhausted (100%) | Heading: "Messaging Quota Exhausted" <br> Body: "External WhatsApp/SMS messages are paused to protect company costs. Critical appointment updates continue via front-desk in-app alerts." | Clear policy explanation |
| AI Hallucination Safety Disclaimer | "✦ AI-suggested content. Sourced exclusively from clinical shorthand and doctor history. Review and sign before finalizing." | Regulatory and DPDP compliance notice |
| Destructive Action: Discard AI Draft | Button: "Discard Draft" <br> Dialog: "Discard generated draft? Any unsaved shorthand dictation will be cleared." | Prevents accidental loss of speech input |

---

## UI Considerations & State Coverage

The state matrix below covers all applicable UI conditions resolved from `ui-consideration-probe.cjs`:

| Element | Consideration | Status | Verification | Concrete Resolution |
|---------|---------------|--------|--------------|---------------------|
| `E1` (Notification Drawer) | `empty` | resolved | explicit | Centered soft Bell icon with "All caught up" heading and "You have no unread notifications or pending patient replies." |
| `E1` (Notification Drawer) | `loading` | resolved | explicit | 3 pulsing skeleton rows (`bg-gray-200 animate-pulse h-14 rounded-lg mb-2`) |
| `E1` (Notification Drawer) | `error` | resolved | explicit | "Failed to load notifications. [ Retry ]" banner with inline reload trigger |
| `E1` (Notification Drawer) | `populated` | resolved | explicit | Chronological list of notification items with soft colored category circle, bold title, timestamp, and quick-action buttons |
| `E1` (Notification Drawer) | `overflow` | resolved | explicit | Vertical scroll with smooth thumb, sticky header and sticky filter tabs |
| `E1` (Notification Drawer) | `zero-one-many` | resolved | explicit | Unread badge hidden at 0, shows exact count at 1-99, shows '99+' above 99 |
| `E1` (Notification Drawer) | `long-text` | resolved | explicit | Notification preview snippets truncate at 2 lines (`line-clamp-2`); full content visible on click |
| `E2` (AI Scribe Modal) | `empty` | resolved | explicit | Shorthand textarea displays placeholder guiding speech or shorthand input |
| `E2` (AI Scribe Modal) | `loading` | resolved | explicit | Pulsing audio ring during dictation; shimmering skeleton lines inside preview card during LLM SOAP synthesis |
| `E2` (AI Scribe Modal) | `error` | resolved | explicit | "AI Service temporarily unavailable. Your raw notes are preserved in the box above. [ Retry ]" |
| `E2` (AI Scribe Modal) | `populated` | resolved | explicit | Card displays structured SOAP sections with '✦ AI Suggested Draft' header and 'Accept & Insert' primary button |
| `E2` (AI Scribe Modal) | `overflow` | resolved | explicit | Modal body scrolls vertically if draft is long, with sticky footer buttons |
| `E3` (Catch-Up Summary) | `zero-one-many` | resolved | explicit | 0 past visits: hidden; 1 past visit: concise note; 2+ visits: expandable 3-bullet summary |
| `E4` (Prescription Chips) | `empty` | resolved | explicit | Hides chip bar if doctor has no historical prescriptions for the selected diagnosis |
| `E4` (Prescription Chips) | `populated` | resolved | explicit | Horizontal scrollable bar of up to 4 most frequent combinations; 1-click appends to Rx table |
| `E5` (Public Document Viewer)| `empty/error` | resolved | explicit | When token is expired or invalid, displays alert: "This document link has expired for patient security. Please call [Phone] for a new copy" |
| `E5` (Public Document Viewer)| `populated` | resolved | explicit | Daylight canvas (#F7F6F3), clinic header, document card with "Download Official PDF" button and embedded viewer |

---

*Contract Approved: Ready for Phase 05 Planning*
