---
version: 1.0
name: Clinic App Master Design System
status: canonical
theme: light-only
font: Inter
---

# Clinic App Master Design System

> **Canonical design specification for the clinic application.**
>
> This file is the single source of truth for visual design, interaction design, component behavior, layout, accessibility, and AI-generated UI.
>
> The uploaded design analyses are reference material only. They must not be combined mechanically or reproduced literally.

---

# 1. Design North Star

The clinic application should feel:

- **Premium** — refined, restrained, carefully spaced, visually confident.
- **Simple** — users should understand what to do without learning the interface.
- **Fast** — common clinic tasks should require as few decisions and clicks as practical.
- **Calm** — suitable for long periods of use by doctors and clinic staff.
- **Modern** — contemporary SaaS quality without becoming trendy or decorative.
- **Trustworthy** — healthcare-appropriate without looking like a generic medical template.
- **Information-first** — important information is scannable before secondary information.
- **Consistent** — the same pattern behaves the same everywhere.
- **Accessible** — status and meaning never depend on color alone.

### Core principle

> **Simple design. Simple operation. High-quality details.**

The interface should not try to impress users with complexity. The premium feeling must come from typography, spacing, alignment, hierarchy, consistency, subtle surfaces, and excellent interaction states.

---

# 2. Non-Negotiable Rules

These rules override any conflicting recommendation from a reference design file.

## 2.1 Light Theme Only

There is **no dark theme**.

Do not create:

- dark mode
- dark theme tokens
- dark navigation shells
- dark cards
- dark featured cards
- dark modal dialogs
- dark drawers
- dark footers
- dark dashboard panels
- dark hero sections
- black UI islands

Dark charcoal is allowed for **text and icons only**.

The entire application should remain a light, daylight-oriented workspace.

## 2.2 No Decorative Gradients

Do not use:

- mesh gradients
- aurora gradients
- glow gradients
- gradient buttons
- gradient cards
- decorative color washes

Premium feeling comes from composition, not gradients.

## 2.3 One Structural Accent

Use one primary brand color for:

- primary actions
- links
- active navigation indicators
- focus states
- selected tabs
- selected controls

Do not introduce additional structural brand colors.

Semantic colors are an exception and are reserved for state communication.

## 2.4 Cards Are Not the Default Container

Do not put every section inside a card.

Use a card when a group needs visible containment or separation.

Prefer:

- page sections
- whitespace
- hairline dividers
- table grouping
- subtle surface changes

over a collection of nested cards.

### Card rule

> **One card = one meaningful group of information or one action area.**

Avoid card-inside-card-inside-card layouts.

## 2.5 Avoid Visual Noise

Do not use:

- decorative icon boxes everywhere
- unnecessary badges
- excessive separators
- excessive shadows
- large illustrations inside functional workflows
- gratuitous helper text
- unnecessary confirmation dialogs
- multiple competing primary buttons

## 2.6 Progressive Disclosure

Show the information needed for the current decision first.

Move advanced or rarely-used options into:

- secondary sections
- expandable panels
- drawers
- overflow menus

Do not expose every possible configuration at once.

## 2.7 One Primary Action

A screen should normally have **one visually dominant primary action**.

Examples:

- Appointment page → **Book appointment**
- Consultation → **Complete consultation**
- Prescription editor → **Issue prescription**
- Invoice → **Collect payment**

Secondary actions must visually recede.

---

# 3. Reference-System Synthesis

The uploaded design systems are used selectively.

## Notion

Use for:

- warm, calm canvas
- white working surfaces
- quiet borders
- document-like information hierarchy
- restrained color usage
- subtle elevation

Do not copy:

- decorative sticker palette
- dark hero treatment
- marketing-oriented pill CTA system

The Notion analysis uses a warm `#f6f5f4` canvas, white surfaces, quiet hairlines, and a single blue primary action. Those characteristics are valuable for the clinic workspace.

## IBM Carbon

Use for:

- enterprise-grade structure
- forms
- field states
- tabs
- data-dense layouts
- hairline hierarchy
- strong state modeling
- accessible interaction targets

Do not copy:

- completely square 0px treatment
- enterprise-heavy appearance

The IBM analysis provides useful input/form and tab patterns, including focus and validation treatments and a 48px touch-target philosophy.

## Cal.com

Use for:

- scheduling mental model
- calendar density
- appointment-oriented workflows
- 8px/12px/16px radius hierarchy
- compact professional controls
- product-first workflow design

Do not copy:

- black primary CTA system
- dark footer
- marketing-only composition

The Cal.com analysis explicitly notes that its actual booking widget is outside the analyzed marketing surface, so appointment UI in this system is a product-level design decision inspired by, not copied from, Cal.com.

## Linear

Use for:

- precision
- compact interaction design
- focused hierarchy
- restrained chrome
- strong keyboard/mouse interaction
- status-badge simplicity

Do not copy:

- dark visual theme
- lavender brand color
- dark surface ladder

## Airtable

Use for:

- sober data/workflow feeling
- editorial spacing
- restrained typography
- strong information grouping

Do not copy:

- signature multicolor cards
- dark signature surfaces

## Coinbase

Use for:

- one strong brand accent
- calm financial-data typography
- tabular numeric presentation
- restrained hierarchy

Do not copy:

- dark editorial bands
- trading-specific semantics
- crypto visual language

## Stripi reference file

`DESIGN-stripe.md` was uploaded under that filename, but its contents identify the source as **Stripi**, not Stripe.

Use from it:

- restrained financial-data presentation
- tabular numerics
- small radius hierarchy
- white/light product surfaces

Do **not** treat it as an official Stripe design system.

---

# 4. Brand Personality

The product should visually communicate:

**Calm + Precise + Human + Premium + Practical**

It should not communicate:

**Corporate + Clinical + Cold + Over-designed + Consumer-app**

A doctor should be able to open the application and immediately understand where they are and what needs attention.

---

# 5. Color System

## 5.1 Core Tokens

```yaml
colors:
  brand:
    primary: "#1769E0"
    primary-hover: "#0F5AB8"
    primary-active: "#0B4C9C"
    primary-soft: "#EAF2FF"
    primary-subtle: "#DCEBFF"
    on-primary: "#FFFFFF"

  canvas:
    default: "#F7F6F3"
    white: "#FFFFFF"
    subtle: "#F2F3F4"
    muted: "#ECEEF0"

  surface:
    default: "#FFFFFF"
    raised: "#FFFFFF"
    subtle: "#F7F8F9"
    selected: "#F0F5FF"
    disabled: "#F1F2F4"

  border:
    default: "#E4E5E7"
    subtle: "#ECEDEF"
    strong: "#C9CCD1"
    focus: "#1769E0"

  text:
    primary: "#17181A"
    secondary: "#52565B"
    tertiary: "#73777D"
    disabled: "#A0A5AB"
    inverse: "#FFFFFF"
    link: "#1769E0"

  semantic:
    neutral:
      text: "#5A5A5A"
      background: "#F1F2F4"
      border: "#D9DCE0"

    info:
      text: "#1769E0"
      background: "#EAF2FF"
      border: "#BFD8FF"

    success:
      text: "#18794E"
      background: "#EAF7F0"
      border: "#BDE5CF"

    warning:
      text: "#9A5B00"
      background: "#FFF5E5"
      border: "#F3D39A"

    error:
      text: "#B42318"
      background: "#FDECEA"
      border: "#F2B8B5"
```

### Important

`#1769E0` is the canonical product blue.

Do not replace it with arbitrary Tailwind blues such as `blue-500`, `blue-600`, or `#2563EB`.

If a component needs a new blue value, use an existing token first.

## 5.2 Color Usage Ratio

The interface should feel overwhelmingly neutral.

Use color primarily for:

- actions
- selection
- focus
- status
- links

Do not use color simply to make a card look interesting.

## 5.3 No Structural Dark Surface

These are prohibited:

```text
background: #000000
background: #111111
background: #161616
background: #1c1c1c
background: dark navy
```

for application surfaces.

Dark text is fine.

---

# 6. Typography

## 6.1 Font

Use **Inter** throughout the product.

```css
font-family:
  Inter,
  ui-sans-serif,
  system-ui,
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  sans-serif;
```

Do not introduce multiple display fonts.

The application should feel premium through typography scale and spacing, not through a proprietary font dependency.

## 6.2 Type Scale

```yaml
typography:
  page-title:
    size: 28px
    weight: 600
    line-height: 1.2
    letter-spacing: -0.35px

  page-title-mobile:
    size: 24px
    weight: 600
    line-height: 1.25

  section-title:
    size: 20px
    weight: 600
    line-height: 1.3

  card-title:
    size: 16px
    weight: 600
    line-height: 1.4

  body-lg:
    size: 16px
    weight: 400
    line-height: 1.5

  body:
    size: 14px
    weight: 400
    line-height: 1.5

  body-medium:
    size: 14px
    weight: 500
    line-height: 1.4

  label:
    size: 13px
    weight: 500
    line-height: 1.35

  caption:
    size: 12px
    weight: 500
    line-height: 1.4

  numeric:
    size: 14px
    weight: 500
    line-height: 1.4
    font-feature-settings: "tnum"

  button:
    size: 14px
    weight: 600
    line-height: 1
```

## 6.3 Typography Rules

- Default data text is **14px**, not 12px.
- Use 12px only for metadata and compact labels.
- Do not use 700 weight as the default heading treatment.
- Use 600 for most UI headings.
- Use 400 for body content.
- Keep line height comfortable for long clinical notes.
- Use tabular figures for money, counts, dates, durations, quantities, and other aligned numeric columns.
- Avoid all-caps labels except for rare compact metadata.
- Do not use large marketing-style hero typography inside the application.

---

# 7. Spacing System

Use a 4px base unit.

```yaml
spacing:
  1: 4px
  2: 8px
  3: 12px
  4: 16px
  5: 20px
  6: 24px
  8: 32px
  10: 40px
  12: 48px
  16: 64px
```

Preferred product spacing:

- field-to-field: 16px
- label-to-field: 6px
- section-to-section: 24px
- major section separation: 32px
- page horizontal padding: 24px
- large desktop horizontal padding: 32px
- card padding: 20–24px
- compact card padding: 16px

Do not use random spacing values when a token exists.

---

# 8. Border Radius

Use restrained rounded geometry.

```yaml
radius:
  none: 0px
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  pill: 9999px
```

## Usage

| Radius | Use |
|---|---|
| 4px | compact chips, small controls |
| 6px | inputs/selects where compact |
| 8px | buttons, standard controls |
| 12px | cards, panels, tables, dialogs |
| 16px | major containers, prominent empty states |
| pill | status badges and compact semantic tags only |

### Do not

- Make every component a pill.
- Use 20px/24px/32px radius for normal application cards.
- Use pill-shaped form fields.
- Use pill-shaped primary buttons by default.

---

# 9. Elevation and Depth

Use borders first and shadows second.

## Level 0 — Flat

Default:

```css
border: 1px solid var(--border-default);
box-shadow: none;
```

Used for:

- cards
- tables
- sections
- form panels

## Level 1 — Raised

```css
box-shadow:
  0 1px 3px rgba(23, 24, 26, 0.06),
  0 4px 12px rgba(23, 24, 26, 0.04);
```

Used for:

- popovers
- dropdowns
- floating command surfaces
- elevated cards only when needed

## Level 2 — Modal

```css
box-shadow:
  0 12px 32px rgba(23, 24, 26, 0.12),
  0 4px 12px rgba(23, 24, 26, 0.06);
```

Used for:

- dialogs
- drawers

Do not use large shadows on ordinary cards.

---

# 10. Application Shell

## Desktop

```text
┌──────────────────────────────────────────────────────────────┐
│ Sidebar │ Top bar                                           │
│         ├────────────────────────────────────────────────────┤
│         │                                                    │
│         │ Page header                                       │
│         │                                                    │
│         │ Content                                            │
│         │                                                    │
│         │                                                    │
└─────────┴────────────────────────────────────────────────────┘
```

### Sidebar

Desktop width:

```text
248px
```

Characteristics:

- white surface
- right hairline border
- quiet navigation
- clear active state
- no heavy background blocks
- no gradients
- no oversized icons

Suggested navigation groups:

```text
Overview

Patients
Appointments
Consultations
Prescriptions
Lab
Referrals

Billing
Reports

Settings
```

The actual module list may evolve with product scope, but the navigation hierarchy should remain simple.

### Active Navigation

Use:

- subtle `primary-soft` background
- primary-colored icon or indicator
- primary/primary-strong text

Do not use a full saturated blue rectangle around the entire nav item.

## Top Bar

Height:

```text
64px
```

Contains:

- page/context identity
- search when useful
- contextual actions
- notifications
- user profile

Do not overcrowd the top bar with every possible action.

---

# 11. Page Layout

Every application page should generally follow:

```text
Page title
Supporting context
Primary / secondary actions

Main content
```

### Page Header

```text
Title                     [Secondary] [Primary]
Supporting description
```

or:

```text
Title
Subtitle
                           [Actions]
```

Do not make the user hunt for the main action.

### Maximum content width

For dense product workflows:

```text
max-width: 1440px
```

For narrow clinical forms:

```text
max-width: 960–1100px
```

For reading-heavy notes:

```text
max-width: 900px
```

Do not force every page to the same width.

---

# 12. Buttons

## 12.1 Primary Button

```yaml
height: 40px
padding: 0 16px
radius: 8px
background: "#1769E0"
text: "#FFFFFF"
font-size: 14px
font-weight: 600
```

Hover:

```text
#0F5AB8
```

Pressed:

```text
#0B4C9C
```

Disabled:

```text
background: #E6EDF6
text: #8A9AAF
```

## 12.2 Secondary Button

```text
background: #FFFFFF
border: 1px solid #C9CCD1
text: #17181A
radius: 8px
```

## 12.3 Tertiary Button

No container.

```text
background: transparent
text: primary or secondary text
```

Use for:

- less important actions
- inline actions
- "View all"
- secondary navigation

## 12.4 Destructive Button

Use red only when the action is destructive.

Do not make "Cancel" or "Remove from view" red unless it actually destroys data or has meaningful negative consequences.

## 12.5 Icon Button

Default:

```text
40 × 40px
radius: 8px
```

Touch:

```text
44 × 44px minimum
```

Icons:

```text
16–20px
```

Do not use circular icon buttons by default.

---

# 13. Forms

Forms must feel **effortless**.

## 13.1 Form Philosophy

- Labels above inputs.
- Clear grouping.
- Short forms where possible.
- Sensible defaults.
- Avoid unnecessary required fields.
- Inline validation.
- Preserve entered data on validation failure.
- Use progressive disclosure for advanced options.
- Never use a multi-step wizard when one screen can reasonably handle the task.

## 13.2 Label

```text
13px
weight: 500
color: text-secondary
```

Required fields:

```text
Patient name *
```

Avoid:

```text
Patient Name (required)
```

unless required by the specific flow.

## 13.3 Input

```yaml
height: 40px
mobile-height: 44px
padding: 0 12px
radius: 6px
background: "#FFFFFF"
border: "#C9CCD1"
font-size: 14px
```

Focus:

```text
border: 2px #1769E0
```

Do not cause the layout to jump when focus appears.

## 13.4 Helper Text

Use helper text only when it prevents uncertainty.

```text
12–13px
color: text-tertiary
```

## 13.5 Validation

Errors should contain:

- clear text
- field association
- icon where useful
- visual state

Never rely only on a red border.

Example:

```text
Phone number *
[ 98220 12345              ]
! Enter a valid 10-digit mobile number.
```

## 13.6 Selects / Comboboxes

Use the same geometry as inputs.

Avoid custom decorative dropdowns.

Searchable controls should be used when the list is large.

## 13.7 Text Areas

Use for:

- clinical notes
- instructions
- remarks

Minimum comfortable height:

```text
96px
```

Allow expansion for long clinical notes.

## 13.8 Form Columns

Desktop:

```text
1-column: narrative / clinical notes
2-column: short structured data
```

Mobile:

```text
always 1-column
```

Do not create 3–4 column forms simply to fill space.

---

# 14. Tabs

Tabs are for **switching between related views**.

They are not buttons.

## 14.1 Primary Tabs

Use an underline model:

```text
Overview   Visits   Prescriptions   Labs   Billing
────────
```

Inactive:

```text
color: text-tertiary
```

Active:

```text
color: text-primary
border-bottom: 2px solid brand-primary
```

Height:

```text
40–44px
```

## 14.2 Segmented Controls

Use a segmented control only for mutually exclusive modes.

Example:

```text
[ List ] [ Calendar ]
```

Container:

```text
background: #F2F3F4
radius: 8px
padding: 3–4px
```

Active segment:

```text
background: #FFFFFF
border: 1px solid #E4E5E7
radius: 6px
```

Do not use a segmented control for ordinary navigation.

---

# 15. Cards

## Standard Card

```yaml
background: "#FFFFFF"
border: "1px solid #E4E5E7"
radius: 12px
padding: 20px
shadow: none
```

## Large Card

```yaml
padding: 24px
radius: 12px
```

## Card Header

```text
Title                           Optional action
Supporting description
```

Do not put a second card inside unless the nested content is genuinely independent.

## Card Rule

If a section still reads clearly without a border, consider removing the card.

---

# 16. Tables

Tables are a major clinic-app surface and must prioritize scanability.

## Table Typography

```text
header: 12–13px / 600
body: 14px / 400
numeric: 14px / 500 with tabular figures
```

## Row Height

Default:

```text
44px
```

Compact administrative tables:

```text
40px minimum
```

Touch/tablet:

```text
48px
```

## Table Styling

- white background
- subtle bottom borders
- no heavy grid lines around every cell
- no zebra striping by default
- row hover is subtle
- selected row uses `primary-soft`
- sortable columns expose clear affordances

## Headers

Use sentence case.

Avoid:

```text
PATIENT NAME
MOBILE NUMBER
APPOINTMENT STATUS
```

Prefer:

```text
Patient
Mobile
Appointment status
```

## Numeric Alignment

Money, counts, duration, and quantities may use right alignment.

Dates and times should remain easy to scan.

---

# 17. Search and Filters

Search is a first-class interaction in clinic workflows.

## Search Field

Height:

```text
40px
```

Use:

- search icon
- placeholder
- clear button after typing

Example:

```text
⌕ Search patients
```

Do not require opening a filter panel for the most common filters.

## Filters

Use compact filter controls near the table header.

```text
Search patients    [Status ▾] [Doctor ▾] [Date ▾]
```

Avoid 8–10 visible filters at once.

Use "More filters" for advanced filters.

---

# 18. Status System

Status is a communication system, not decoration.

Every status must communicate through:

1. text
2. optional icon
3. color

Never color alone.

## Semantic Classes

### Neutral

```text
background: #F1F2F4
text: #5A5A5A
```

Use for:

- Draft
- Not started
- Inactive

### Info

```text
background: #EAF2FF
text: #1769E0
```

Use for:

- Scheduled
- Upcoming
- Information
- Open

### Success

```text
background: #EAF7F0
text: #18794E
```

Use for:

- Confirmed
- Completed
- Paid
- Issued

### Warning

```text
background: #FFF5E5
text: #9A5B00
```

Use for:

- Waiting
- Pending
- Due soon
- Partial

### Error

```text
background: #FDECEA
text: #B42318
```

Use for:

- Cancelled
- Failed
- Overdue
- No-show
- Validation failure
- Critical state

## Status Badge

```yaml
height: 24px
padding: 0 8px
radius: pill
font-size: 12px
font-weight: 500
```

Icons:

```text
12–14px
```

Keep badges compact.

Do not turn every value into a badge.

---

# 19. Appointment Design

Appointment workflows are one of the primary product workflows.

## Appointment List

Prioritize:

```text
Time
Patient
Doctor
Type
Status
Actions
```

Avoid presenting every possible appointment property in the default table.

## Appointment Status Examples

```text
Scheduled
Confirmed
Checked in
Waiting
In consultation
Completed
Cancelled
No-show
```

Use the semantic color classes above.

## Appointment Creation

Primary flow:

```text
Patient
Doctor
Date
Time
Appointment type
Reason / note (optional)
```

Do not bury time selection inside several nested dialogs.

## Calendar

Calendar should support:

- day
- week
- agenda/list

Default the clinic to the view that best matches its operating workflow.

Keep calendar visual density readable.

Do not turn every appointment into a large colorful event block.

---

# 20. Patient Profile

The patient profile is a **workspace**, not a dashboard full of widgets.

## Header

```text
Patient name
Age · Gender · DOB
Phone
Key alerts / allergies
[Primary action]
```

Primary patient actions should be immediately visible.

## Profile Navigation

Recommended:

```text
Overview
Visits
Prescriptions
Labs
Referrals
Billing
```

## Overview

Prioritize:

- current/recent visit
- important clinical information
- recent prescriptions
- recent lab activity
- outstanding balance if relevant
- next appointment

Avoid displaying every historical item at the top.

## Patient Information

Use a two-column summary for structured information.

Do not place every field in a card.

---

# 21. Consultation

Consultation must optimize for **clinical speed**.

Suggested hierarchy:

```text
Patient context

Chief complaint
Vitals
Clinical notes
Diagnosis
Treatment / plan
Prescription

[Save draft] [Complete consultation]
```

Do not force doctors through wizard-like pages for normal consultations.

## Clinical Notes

Use generous text area height.

Allow:

- keyboard-first entry
- quick structured fields
- templates where clinically appropriate
- autosave where technically safe

Do not visually overwhelm the clinician with every optional field.

---

# 22. Prescription

Prescription creation should feel like a focused data-entry workflow.

Typical structure:

```text
Medicine
Dose
Frequency
Duration
Instructions
```

The common path should be fast.

Use searchable medicine selection rather than requiring manual typing where appropriate.

Use repeatable rows for medicines.

Avoid excessive card wrapping around every medicine row.

---

# 23. Lab Results

Lab results should optimize for comparison and trend recognition.

Use tables or structured lists for:

```text
Test
Result
Unit
Reference range
Date
```

Flag abnormal results with:

- text label
- icon
- semantic color

Do not rely on red/green alone.

---

# 24. Billing and Payments

Billing should use financial-data conventions without becoming a finance-product clone.

Use tabular figures.

Align:

```text
Amount
Tax
Discount
Total
Balance
```

right where appropriate.

Suggested hierarchy:

```text
Subtotal
Discount
Tax
Total
Paid
Balance due
```

Primary actions should be obvious:

```text
Record payment
Generate invoice
```

Avoid making financial screens look more complex than necessary.

---

# 25. Drawers and Modals

## Use a Drawer When

The user is editing contextual information and should retain awareness of the underlying page.

Examples:

- patient quick view
- appointment details
- quick edit
- filter details

## Use a Modal When

The user must focus on one decision.

Examples:

- destructive confirmation
- irreversible action
- small focused form

## Do Not

- put a complete multi-screen workflow in a tiny modal
- nest modals
- use dark modal backdrops
- make modals full-screen on desktop unless the workflow genuinely needs it

Backdrop:

```text
rgba(23, 24, 26, 0.18–0.24)
```

The dialog itself remains white.

---

# 26. Toasts and Notifications

Use toasts for:

- completed saves
- successful updates
- background actions
- non-blocking warnings

Do not use toasts for information that must remain visible.

Toast style:

```text
white surface
1px border
subtle shadow
12px radius
icon + message
optional action
```

Avoid brightly colored full-width banners unless the issue is important.

---

# 27. Empty States

Empty states should be useful, not decorative.

Structure:

```text
Icon / subtle illustration

Title

One sentence explaining what will happen

[Primary action]
```

Example:

```text
No appointments today

Appointments scheduled for today will appear here.

[Book appointment]
```

Do not use giant illustrations.

---

# 28. Loading States

Prefer skeletons for content regions.

Skeletons should use:

```text
#ECEEF0
```

with restrained animation.

Do not show spinners for content that can have a meaningful skeleton.

Use a spinner for short actions such as:

```text
[Saving…]
```

---

# 29. Error States

Errors must explain:

- what happened
- what the user can do

Bad:

```text
Something went wrong.
```

Better:

```text
We couldn't save this consultation.

Check your connection and try again.

[Try again]
```

Never expose raw technical errors in the primary user message.

---

# 30. Icons

Use one consistent icon family throughout the product.

Recommended:

```text
Lucide-style outline icons
```

Default sizes:

```text
16px — inline
18px — controls
20px — navigation
24px — prominent empty states
```

Use icons to clarify meaning, not to decorate every heading.

Do not mix filled, outlined, 3D, emoji, and illustrated icon styles.

---

# 31. Accessibility

Accessibility is a design requirement, not a later enhancement.

## Contrast

Text and controls must meet WCAG AA contrast requirements.

## Keyboard

All interactive elements must be keyboard accessible.

Visible focus state:

```text
2px brand-primary focus ring
```

Do not remove focus outlines without replacing them.

## Touch

Minimum target:

```text
44 × 44px
```

for touch interaction.

Desktop controls may visually remain around 40px while retaining accessible interactive hit areas.

## Color Independence

Never communicate meaning with color alone.

Bad:

```text
● red
```

Better:

```text
⚠ Overdue
```

## Text

Do not rely on 10–11px text for core information.

---

# 32. Responsive Design

Use these product breakpoints:

```yaml
breakpoints:
  mobile: "< 640px"
  tablet: "640–1023px"
  desktop: "1024–1279px"
  desktop-large: "1280–1439px"
  wide: ">= 1440px"
```

## Mobile

- sidebar becomes drawer
- tables become horizontally scrollable or convert to list rows
- forms become single-column
- actions move into a clear top/bottom action area
- page header wraps gracefully
- no tiny compressed controls

## Tablet

- sidebar may become compact/icon navigation
- grids reduce from 3/4 columns to 2
- forms remain 2-column only where fields are genuinely short

## Desktop

- persistent navigation
- multi-column layouts
- comfortable data density

## Wide Desktop

Do not scale everything larger.

Increase breathing room rather than dramatically increasing typography.

---

# 33. Motion

Motion should be subtle and functional.

Preferred durations:

```text
fast: 120ms
normal: 160ms
slow: 220ms
```

Use easing that feels natural and restrained.

Use motion for:

- opening drawers
- appearing menus
- state changes
- hover/focus feedback

Do not animate:

- every card
- every page section
- every table row
- decorative background effects

Respect:

```text
prefers-reduced-motion
```

---

# 34. Component Hierarchy

Use this priority order when composing a page:

```text
Page
└── Section
    ├── Toolbar
    ├── Content
    │   ├── Card (only when needed)
    │   ├── Table
    │   ├── Form
    │   └── List
    └── Supporting information
```

Avoid:

```text
Page
└── Card
    └── Card
        └── Card
            └── Card
```

Nested cards should be rare.

---

# 35. Density Rules

The clinic app must support high information density without feeling cramped.

## Comfortable

Default for:

- patient lists
- appointments
- billing
- dashboards

## Dense

Use only for:

- admin tables
- high-volume operational screens
- compact result lists

Do not make the entire application dense.

---

# 36. Dashboard Principles

The dashboard should answer:

1. What needs my attention?
2. What is happening today?
3. What changed recently?
4. What action should I take?

Do not make the dashboard a gallery of KPI cards.

Recommended structure:

```text
Today
├── appointments / queue
├── attention items
└── primary quick actions

Recent activity

Operational summary
```

Use KPI cards only where the number itself is genuinely useful.

---

# 37. Search, Command, and Keyboard Efficiency

Frequent staff workflows should be quick.

Potential global shortcuts:

```text
Search patients
Create appointment
Open today's appointments
Open patient
```

Keyboard shortcuts may be provided for power users, but they must never be the only way to access functionality.

A visible command/search interface is preferable to hidden shortcut dependency.

---

# 38. AI Features

AI should feel like a **helpful capability inside the product**, not a separate futuristic interface.

Do not:

- add AI gradients
- add glowing buttons
- make every screen conversational
- create a separate AI visual language

Instead:

```text
AI-assisted summary
Generate draft
Suggest
Review
Insert
```

AI output must be visually distinguishable from confirmed clinical data.

Recommended AI state:

```text
Draft / Suggested
```

with a subtle info treatment.

Clinical information should never appear as confirmed merely because AI generated it.

---

# 39. Premium Design Rules

Premium does not mean more decoration.

Premium comes from:

- consistent 4px spacing rhythm
- deliberate typography
- aligned controls
- restrained borders
- subtle depth
- excellent empty space
- consistent iconography
- balanced card padding
- predictable interactions
- precise microcopy

### Premium checklist

Before shipping a screen, ask:

```text
Is the primary action obvious?
Is the page too card-heavy?
Can any field be removed?
Can any text be shortened?
Is anything competing with the main task?
Are all alignments intentional?
Are the statuses immediately understandable?
Does the page still look good without color?
```

---

# 40. Do Not Build "Generic SaaS"

Avoid visual patterns that make the product look like a template:

- purple gradients
- glassmorphism
- giant rounded cards
- floating neon blobs
- excessive metric cards
- every button as a pill
- dashboard wallpaper graphics
- decorative avatars everywhere
- colorful icon boxes for every module
- huge hero typography inside the app

The application should look like a **finished product**, not a design-system demo.

---

# 41. AI Agent Implementation Rules

These rules are specifically for Claude Code, Cursor, Codex, or other coding agents implementing this DESIGN.md.

## 41.1 This File Is Canonical

When another design reference conflicts with this file:

> **Follow this file.**

Do not import visual tokens from the source files automatically.

## 41.2 Reuse Before Creating

Before creating a new:

- color
- radius
- spacing value
- button variant
- card style
- badge
- input
- modal

check whether an existing token/component already solves the problem.

## 41.3 No Arbitrary Visual Values

Do not invent:

```text
#3498DB
#2563EB
#7C3AED
```

or arbitrary radius/spacing values simply because they are convenient.

Use the canonical tokens.

## 41.4 Do Not Over-Componentize

Do not create a component abstraction merely because two pieces of markup look similar.

Create a reusable component when:

- behavior is shared
- appearance is shared
- accessibility behavior is shared
- consistency matters

## 41.5 Do Not Over-Card

Before adding a card, ask:

> Does this content actually need containment?

If no, use a section and whitespace.

## 41.6 Preserve Simplicity

When two implementations provide the same outcome:

> choose the one with fewer visible controls and fewer user decisions.

## 41.7 Use Real Content Shapes

Do not design only around placeholder text.

Components must accommodate:

- long patient names
- long medicine names
- long clinical notes
- variable phone numbers
- multilingual text
- empty values
- large numeric totals

## 41.8 Build States

Every reusable component should consider:

```text
default
hover
focus
active
disabled
loading
error
empty
```

Only expose states that are relevant to the component.

## 41.9 Do Not Change Layout During Focus

Validation/focus treatments should not cause controls to jump because a border becomes thicker.

Use inset or outline techniques when necessary.

## 41.10 Keep Interaction Predictable

A control that behaves like a button must look like a button.

A tab must behave like a tab.

A badge must not unexpectedly become interactive.

---

# 42. Component Acceptance Criteria

A component is ready only when:

- it follows the token system
- it works in light mode
- it has visible focus
- it has disabled/loading/error states when relevant
- it works with realistic content
- it works on mobile
- it does not introduce a new visual language
- it does not require unnecessary explanation

---

# 43. Page Acceptance Criteria

A page is ready only when:

```text
1. Primary task is obvious within a few seconds.
2. The hierarchy is visually clear without reading every word.
3. There is no unnecessary card nesting.
4. The number of visible actions is controlled.
5. Status is understandable without relying on color alone.
6. Forms are short and logically grouped.
7. Tables remain readable at normal desktop density.
8. The page works on tablet and mobile.
9. Empty/loading/error states exist where required.
10. No dark surfaces or dark theme elements are introduced.
```

---

# 44. Final Visual Direction

The product should feel like:

> **Notion's calm information hierarchy + IBM's enterprise discipline + Cal.com's scheduling clarity + Linear's interaction precision + restrained financial-data presentation — redesigned specifically for clinic workflows.**

But the final application must **not look like Notion, IBM, Cal.com, Linear, Coinbase, Airtable, or Stripi**.

It must look like its own product.

---

# 45. Final Rules — Highest Priority

If an implementation decision is ambiguous, use this priority order:

```text
1. Simplicity
2. Clinical workflow clarity
3. Accessibility
4. Consistency
5. Information hierarchy
6. Efficiency
7. Premium visual polish
8. Decoration
```

Never sacrifice the first six for the last two.

> **The goal is not to build the most visually impressive clinic application.**
>
> **The goal is to build the clinic application that feels so clear, calm, and polished that users barely notice the interface — they simply get their work done.**
