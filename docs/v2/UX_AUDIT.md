# clinicOS v2.0 — UX Audit (Workstream B1 + B6)

| | |
|---|---|
| Author role | Senior Product Designer / UX Architect + Senior Frontend Architect |
| Date | 2026-11-10 |
| Branch | `feature/v2` (v1 baseline = `main`) |
| Status | Discovery only. No code, dependency or configuration changes were made. |
| Companion docs | `INFORMATION_ARCHITECTURE.md`, `DESIGN_SYSTEM.md`, `FRONTEND_TECHNOLOGY_ASSESSMENT.md`, `FRONTEND_MIGRATION_PLAN.md` |

Labels: **Fact** (verified in code), **Problem**, **Risk**, **Assumption (validate)**, **Recommendation**. Priority: **P0** critical / blocker, **P1** essential for v2, **P2** important, **P3** optional.

---

## 0. Method and limits

**Fact.** This audit is a code-based review. Authenticated screens could not be inspected visually, because the app needs the hosted Supabase project, which may be production (see the shared brief). The review covered:

- every file in `app/` (non-API) and `components/` (120 `.tsx` files, about 31.6k lines);
- the token file `app/globals.css`;
- the server actions that each screen calls (`features/*/actions.ts`);
- the permission matrix (`lib/permissions/matrix.ts`);
- the PRD (`docs/clinic-management-prd.md`);
- the vendored TailAdmin template (`docs/temp/free-nextjs-admin-dashboard-main`);
- the deleted v1 `DESIGN.md` (`git show a6373b4^:DESIGN.md`), for history only.

Metrics come from reproducible grep and small Python scripts (no network, no `.env`).

**Outstanding investigations**

| # | Investigation | Why it matters | How (safely) |
|---|---|---|---|
| OI-UX-1 | **Visual walkthrough with synthetic data** of every screen at 360 px, 768 px, 1280 px | Confirms rendering, overflow, real click counts, perceived density | After QA (Workstream E) provides a local Supabase (`supabase start`) with a synthetic seed. Run Playwright screenshots on Desktop Chrome and Pixel 5 (projects already in `playwright.config.ts`). |
| OI-UX-2 | Automated a11y scan (axe-core) of all routes | Quantifies the a11y findings below | `@axe-core/playwright` against the local stack. Do not install until approved. |
| OI-UX-3 | Production bundle sizes per route | `.next/` on disk is a dev build. Sizes are unminified and meaningless. | `next build` against a non-secret, local env file once a local stack exists |
| OI-UX-4 | Field research: 3–5 clinics (1 solo doctor, 1 multi-doctor) observing front-desk peak hour | Validates the assumed task frequencies and device mix (Android phone, desktop, tablet) | Product-owner-led contextual inquiry |
| OI-UX-5 | Confirm intended receptionist permissions (see F-01) | May be a functional blocker | Product-owner decision |

---

## 1. Executive summary

v1 proves the product concept. Its feature breadth is strong: queue tokens, triage vitals, specialty consult templates, CDCI drug search, ICD coding, WhatsApp share, waitlist promotion, AI scribe. The UX foundation is the weakness. Problems compound for the two people who use the product all day: the **receptionist** and the **doctor**.

**Top 12 findings**

| ID | Finding | Priority |
|---|---|---|
| F-01 | **Receptionists cannot register patients by code.** `createPatient` requires `patients:edit` (`features/patients/actions.ts:35`). The receptionist role lacks it (`lib/permissions/matrix.ts:55-61`, asserted in `tests/auth/rbac.spec.ts:42`). Yet the UI shows "Register Patient", "New Patient" walk-in and "New patient" booking to receptionists. The primary front-desk task likely fails with a generic error. This is either a product decision that was never reflected in the UI, or a defect. | **P0** (validate, OI-UX-5) |
| F-02 | **The queue is not live.** The Queue page says "Real-time patient flow…" (`components/queue/queue-view.tsx:114-116`), but nothing subscribes or polls. Data changes only on `router.refresh()` after the user's own action. Doctor and front desk see stale state. Only notifications poll, every 30 s (`components/notifications/use-notifications.ts:14,61`). | **P1** |
| F-03 | **Multi-step writes are orchestrated from the browser and are not atomic.** Walk-in calls `createPatient`, then `createVisit`, then `checkInVisit` (`components/queue/walk-in-drawer.tsx:164,179,195`). Checkout calls `createVisitInvoice`, then `recordPayment`, then `transitionQueueState` (`components/queue/checkout-drawer.tsx:253,270,285`). A failure midway leaves orphan patients, visits or invoices, and a retry duplicates them. | **P1** (with Workstream C) |
| F-04 | **The booking overbook path creates a duplicate patient.** In the "New patient" tab, `handleBook()` calls `createPatient` *before* the conflict check (`components/calendar/booking-drawer.tsx:153`). On conflict, the Overbook dialog's confirm calls `handleBook(true)` again (`:500`). That calls `createPatient` a second time for the same person. | **P1** |
| F-05 | **Five separate patient-creation UIs, and only one runs dedup.** `/patients/new` uses `findPotentialDuplicates`. The walk-in drawer, booking drawer, waitlist drawer and AI quick-registration card do not. This works against the PRD's "dedup on creation … critical in high-volume registration" (PRD §4.3). | **P1** |
| F-06 | **Staff have no reschedule action.** `rescheduleAppointment` is only reachable from the patient-facing token link (`app/api/reschedule/[token]/route.ts:233`) and the WhatsApp webhook. Staff must cancel (`window.confirm`) and rebook, retyping the patient. | **P1** |
| F-07 | **Broken hand-offs from the patient record.** "Book Slot" links to `/calendar?patientId=…`, but the calendar ignores `patientId`. "Add to Queue" is a plain link to `/queue` (`components/patients/patient-detail-view.tsx:150,171`). Both drop the patient context, so the user searches again. | **P1** |
| F-08 | **The consultation can silently lose data.** It has a 15-second debounced autosave (`components/consultation/consultation-workspace.tsx:620-628`) and no `beforeunload` or navigation guard. The "Upload lab report" dropzone in the consult does nothing: its `onChange` body is a comment (`:1539-1545`). | **P1** |
| F-09 | **There is no design system in practice.** The `:root` tokens in `globals.css` are never referenced (0 `var(--…)` uses in TSX). There are 937 arbitrary hex classes across 76 files (442 × `#1769E0`), 3,488 raw palette classes, 330 sub-12 px text sizes (`text-[10px]`/`[11px]`/`[9px]`), 10 radius variants and 12 shadow variants. Inter is declared but never loaded (no `next/font`). | **P1** |
| F-10 | **Dialogs and drawers are inaccessible and inconsistent.** There are 23 hand-rolled overlay implementations. Only 11 screens use the shared `Modal`. None trap focus or restore it (0 focus-trap/`inert`/`tabIndex` uses). The walk-in and checkout drawers lack `role="dialog"`. There are 27 `alert()`/`confirm()` calls and no toast system. | **P1** |
| F-11 | **No route-level loading, error or not-found states.** There are 0 `loading.tsx`, 0 `error.tsx` and 0 `not-found.tsx` files. Server pages block on sequential Supabase calls with no skeleton. A thrown error shows the Next default error page. | **P1** |
| F-12 | **Mobile is "responsive", not mobile-first.** The calendar timeline is `min-w-[780px]` (`components/calendar/doctor-timeline.tsx:221`), so it scrolls horizontally on phones. Slot labels appear only on hover (`opacity-0 group-hover`). There are 116 `h-7/8/9` (28–36 px) touch targets. Eight icon-only buttons lose their text label below `sm`. Inputs use 14 px text, which triggers iOS Safari zoom-on-focus. There is no bottom navigation. | **P1** |

> Verification (2026-11-10): PARTIALLY_CONFIRMED — F-01: confirmed, but the error shown is a clear permission message, not a generic one; the RLS comment shows receptionists were intended to create patients. H/P0 (PO-3). See VERIFICATION_LOG.md

> Verification (2026-11-10): PARTIALLY_CONFIRMED — F-09: `:root` variables are dead, but the `@theme` brand scale is used ~193 times (bypassed by 937 hex classes); Inter never loaded; `animate-in` inert. M/P1. See VERIFICATION_LOG.md

> Verification (2026-11-10): PARTIALLY_CONFIRMED — F-10: about 21 hand-rolled overlays (not 23); no focus trap/restore; duplicate IDs only when overlays stack (not observed); 27 `alert()`/`confirm()` calls. H/P1. See VERIFICATION_LOG.md

> Verification (2026-11-10): PARTIALLY_CONFIRMED — F-11: confirmed, but `status-actions` is a counter-example (renders errors inline). M/P1. See VERIFICATION_LOG.md

**Recommendation (summary).** Rebuild the frontend on a token-driven system:

- Use shadcn/ui-style open-code components on accessible headless primitives (see `FRONTEND_TECHNOLOGY_ASSESSMENT.md`).
- Collapse the front desk into a single live **Today** workspace and a universal **Find / Add patient** command.
- Move every multi-step write into one server-side transaction (RPC) per business action.
- Redesign the consultation into a keyboard-first, two-pane workspace with explicit save state.

Migrate incrementally, highest-traffic workflow first (`FRONTEND_MIGRATION_PLAN.md`).

---

## 2. Quantified baseline (v1)

All counts are over `app/**/*.tsx` and `components/**/*.tsx` (120 files). The scripts are in the session scratchpad (not committed). Re-run them with the greps listed in Appendix A.

| Metric | Value | Comment |
|---|---|---|
| `.tsx` files / lines | 120 / ~31.6k | Largest files: `consultation-workspace.tsx` 1,681; `checkout-drawer.tsx` 1,029; `prescription-builder.tsx` 926 |
| Client components (`"use client"`) | 90 / 120 (75%) | Pages are mostly server. Nearly all UI below them is client. |
| Shared primitives in `components/ui` | 12 (`alert, badge, button, card, dropdown, empty-state, field, input, modal, phone-input, select, table`) | No Dialog/Sheet, Tabs, Combobox, Popover, Tooltip, Toast, Skeleton, Checkbox/Radio, DatePicker, Textarea or Pagination |
| Raw `<button>` vs `<Button>` | 254 vs 153 | Most buttons are bespoke. 16 buttons have no `type` attribute. |
| Raw `<input>` vs `<Input>` | 62 vs 92 | Heuristic: about 50 raw inputs have neither `id` nor `aria-label`. Some may be implicitly wrapped by a `<label>`. |
| Raw `<select>` vs `<Select>` | 28 vs 2 | The shared `Select` is almost unused. 13 raw selects have no id or aria-label. |
| Raw `<table>` vs `<Table>` | 7 vs 4 | |
| Overlay implementations (`fixed inset-0`) | 23 files. Only 11 use `<Modal>`. | Includes 6 bespoke drawers (walk-in, checkout, booking, waitlist, patient-history, notification, copilot, webhook logs) |
| Focus trap / `inert` / `tabIndex` | 0 | |
| `role="dialog"` | 17 in 16 files | Missing on walk-in and checkout drawers |
| `role="tablist"`/`tab` | 0 | Patient tabs, walk-in tabs and cabin tabs are plain buttons |
| `aria-*` attributes | 148 total (71 `aria-label`, 3 `aria-invalid`, 3 `aria-expanded`, 1 `aria-current`) | No `aria-describedby` linking errors to fields (`components/ui/field.tsx:41` renders an id that nothing references) |
| `alert()` / `confirm()` | 27 | e.g. `components/calendar/calendar-view.tsx:185,200`, `components/patients/patient-visit-history.tsx:68-90` |
| Toast system | none | |
| `<Link>` wrapping `<Button>` (nested interactive) | 26 | Invalid HTML (`<a><button>`). Double tab stop. e.g. `app/(dashboard)/page.tsx:89-103` |
| Arbitrary hex classes `[#xxxxxx]` | 937 in 76 files | 442 × `#1769E0`, 60 × `#EAF2FF`, 30 × `#111827`, 28 × `#155CC0` (a hover shade not in any token) |
| Raw Tailwind palette classes | 3,488 | gray 2,340 · emerald 367 · amber 260 · rose 158 · blue 117 · slate 97 · red 71 · indigo 41 · purple 23 |
| Defined CSS custom properties used in TSX | 0 | `:root` "canonical tokens" (`app/globals.css:25-61`) are dead |
| `brand-*` theme classes | 193 | So brand colour is expressed three ways: `brand-*`, `[#1769E0]`, and `blue-*` |
| Sub-12 px text | 330 (`text-[11px]` 222, `[10px]` 106, `[9px]` 2) | Too small for the target audience and devices |
| `text-gray-400` (≈2.6:1 on white, fails AA) | 267 | Used for meta text, placeholders and icons |
| Radius variants | 10 (`rounded-xl` 321, `-lg` 316, `-full` 117, `rounded` 104, `-md` 64, `-2xl` 58 …) | |
| Shadow variants | 12 | `shadow-xs`, `-2xs`, `-theme-xs` … mixed |
| `uppercase` labels | 139 | Shouting micro-labels. Poor for scanning Indian names. |
| Route `loading.tsx` / `error.tsx` / `not-found.tsx` | 0 / 0 / 0 | |
| `Suspense` | 6 (auth pages only) | |
| Forms: `useActionState` / `useFormStatus` / `<form action>` | 0 / 0 / 0 | All 37 `onSubmit` handlers are manual `useState` with imperative server-action calls |
| Realtime (`.channel(`) / polling | 0 / 1 (notifications, 30 s) | |
| Date formatting | 56 `toLocale*` calls: 13 `en-IN` date, 11 `en-IN` datetime, 9 `en-IN` time, **7 `en-US`**, **8 locale-less** | No shared formatter. No explicit `Asia/Kolkata` time zone in UI formatting. |
| "Today" computed as UTC (`toISOString().split("T")[0]`) | 29 sites across app/components/features/lib | Between 00:00 and 05:29 IST, "today" is yesterday |
| Currency formatting | 56 literal `₹` concatenations, 0 `Intl.NumberFormat` | `₹1500` instead of `₹1,500`. `type="number"` money inputs. |
| `animate-in` / `slide-in-from-*` classes | 16 files | No animation plugin installed (`tw-animate-css` absent). These classes do nothing. |
| Global shell imports AI chat SDK | `components/layout/app-header.tsx:9` statically imports `OperationsCopilotDrawer` (`useChat` from `@ai-sdk/react`) | Ships the AI chat code on every authenticated page |
| UI component / e2e / visual tests | 0 rendering tests (no jsdom/testing-library), `tests/e2e/` does not exist | Playwright config exists with no specs |

> Verification (2026-11-10): PARTIALLY_CONFIRMED — UX-12: 29 sites exact; about 74 `toLocale*` lines (not 56; 9 en-US); some paths already pin Asia/Kolkata. H/P1. See VERIFICATION_LOG.md

---

## 3. B1 assessment by dimension

### 3.1 Overall visual quality and consistency — **P1**

- **Fact.** The look is TailAdmin-derived: white cards on an off-white canvas, `rounded-xl/2xl`, metric tiles with tinted icon squares, uppercase micro-labels. The v1 `DESIGN.md` (deleted) said "Cards are not the default container" (§2.4) and "One structural accent" (§2.3). The code does the opposite. Cards wrap everything, and status uses six hue families (amber, emerald, rose, blue, purple, indigo) with no mapping.
- **Problem.** The same visit status renders differently on different screens. `StatusBadge` (`components/ui/badge.tsx:66-84`) maps "waiting" to warning. `QueueCard.getStatusBadge` (`components/queue/queue-card.tsx:41-75`) re-implements the mapping with different borders. The dashboard, cabin, visits register and consultation header each have their own. 12 files hard-code `"in_consultation"` styling.
- **Problem.** Primary buttons override their own variant inline (`className="… bg-[#1769E0] … hover:bg-[#155cc0]"`, e.g. `components/queue/status-actions.tsx:109,123`). The hover shade `#155CC0` exists in no token.
- **Recommendation.** One semantic token layer and one `StatusChip` driven by a single `visitStatus → {label, tone, icon}` map. Flat surfaces separated by hairlines instead of nested cards. See `DESIGN_SYSTEM.md` §3 and §6.

### 3.2 Navigation and information architecture — **P1**

> Verification (2026-11-10): PARTIALLY_CONFIRMED — UX-3.2: only the queue "Start Consultation" button changes state (dashboard links do not); new: `/consultation/[id]` has no permission gate, so receptionists can view clinical data. H/P1. See VERIFICATION_LOG.md

- **Fact.** The sidebar (`components/layout/app-sidebar.tsx:36-143`) gives a receptionist Dashboard, Live Queue, Visits, Calendar, Patients and Referrals. A doctor gets Doctor's Cabin, Visits, My Calendar, Patients and Referrals. Owner/admin additionally get Staff, Clinic Profile, Billing & Reports and Developer Settings. `components/dashboard/nav.tsx` is a dead, older nav (no importers).
- **Problem.** Three overlapping views of the same visit data: Dashboard (top 8 visits plus 4 counters), Live Queue (all visits plus 4 counters) and Visits register. Front-desk staff have to choose between them.
- **Problem.** The receptionist "Dashboard" offers **Consult/Resume** buttons (`app/(dashboard)/page.tsx:289-310`) and the queue offers **Start Consultation** (`components/queue/status-actions.tsx:116-129`) regardless of role. A receptionist clicking it moves the visit to `in_consultation` (allowed by `appointments:edit`) and lands on a consultation page they cannot use. That is a state-corrupting mis-click.
- **Problem.** Shortcuts are unconventional. ⌘/Ctrl+K opens the **AI copilot**, and `/` or ⌘/ opens search (`components/layout/app-header.tsx:38-47`). Users from other SaaS tools expect ⌘K to mean "find".
- **Problem.** The receptionist has no place to see the day's collections or close the cash drawer. Billing & Reports is owner/admin-only.
- **Recommendation.** Use role-based IA with **Today** as home for front desk, nurse and doctor. ⌘K opens the universal command palette (patient search plus actions), and AI is an entry *inside* the palette. Full proposal in `INFORMATION_ARCHITECTURE.md`.

### 3.3 User journeys and task completion — **P1**

See §5 (per workflow). The recurring anti-pattern is the **context drop**: an action takes the user to a generic page and they search again (F-07). The other is **client-orchestrated multi-call writes** (F-03, F-04).

### 3.4 Dashboard usefulness — **P2**

- **Fact.** The front-desk dashboard (`app/(dashboard)/page.tsx`) shows four counters (Waiting, With Doctor, Completed, Total registered patients), quick links and the first 8 of today's visits (`visits.slice(0, 8)`).
- **Problem.** "Total registered patients" is a vanity metric for front desk. The 8-row cap hides patients. Counters duplicate the queue page. The date is formatted `en-US` ("Tuesday, November 10, 2026") (`:67`). The page is not live.
- **Recommendation.** Remove the generic dashboard for operational roles and replace it with **Today** (§5.4 wireframe). Owner/admin get a light **Overview** (today's collections, no-show rate, patients seen per doctor, outstanding dues) built as tables and sparklines, not chart walls.

### 3.5 Form design and data entry — **P1**

> Verification (2026-11-10): PARTIALLY_CONFIRMED — UX-3.5: 3 of 4 money inputs are already clamped at >= 0; no `Intl.NumberFormat`; 66 literal `₹` lines. M/P2 (absorbed by M4.5). See VERIFICATION_LOG.md

- **Fact.** Every form is manual `useState` + `onSubmit` + imperative server-action call. There are 0 uses of `useActionState`, `useFormStatus` or `<form action>`. Validation errors come back as `fieldErrors` and are shown only on some forms. `Field` renders `${htmlFor}-error` but no input references it via `aria-describedby` (`components/ui/field.tsx:41`).
- **Problem.** Registration (`app/(dashboard)/patients/new/page.tsx`) is a long single-column form that captures address and ABHA. It does **not** capture allergies, even though allergies are the most safety-relevant field and the consultation header relies on them.
- **Problem.** Money inputs are `type="number"` (`components/queue/checkout-drawer.tsx:616,756,793,867`). The mouse wheel changes values, and `e`, `-` and fractional paise are accepted. Amounts are coerced with `Number(...)`.
- **Problem.** Inputs use `text-sm` (14 px), which makes iOS Safari zoom on focus. Mobile keyboards are not tuned (`inputMode`/`enterKeyHint`/`autoComplete` are missing on name and pincode fields).
- **Recommendation.** One form stack (react-hook-form + zod schemas shared with the server action; see the technology assessment). Inputs are 16 px on mobile. Use a dedicated `MoneyInput` (₹, en-IN grouping, integer paise), `PhoneInput` (kept), `AgeOrDobInput` (kept, restyled) and `AllergyInput` (chips, with "No known allergies" as an explicit choice).

### 3.6 Tables, search, filters, pagination — **P1**

- **Fact.** `/patients` loads **every** patient of the tenant in one query (`app/(dashboard)/patients/page.tsx:32-35`) and filters client-side (`components/patients/patient-directory-table.tsx:93`). It falls back to remote search beyond the local filter.
- **Fact.** `searchPatients` returns `select("*")`, the full patient rows including address, allergies and emergency contact, to a typeahead (`features/patients/actions.ts:259`). It uses substring `ilike`, has no ranking and is capped at 25 rows.
- **Problem.** There is no pagination anywhere. Registers (visits, referrals, collections) use bespoke filter bars of raw `<select>` with no labels (`components/visits/visits-register-view.tsx:355,372,388`). Filters are not in the URL, so a filtered view cannot be shared or bookmarked.
- **Risk.** Typeahead through server actions: Next.js runs server actions sequentially per client, so fast typing queues requests. Latency grows on slow 4G.
- **Recommendation.** Server-side paginated tables (TanStack Table, headless) with URL-state filters. A dedicated search endpoint returning a minimal projection (name, age/sex, masked phone, last visit, patient ID), ranked with phone-exact first and then trigram name similarity (backend dependency, Workstream C). Data lists replace tables on mobile.

### 3.7 Modal and dialog behaviour — **P1**

- **Fact.** The shared `Modal` (`components/ui/modal.tsx`) closes on Esc and backdrop click and locks body scroll. It does not trap focus, does not restore focus to the trigger, and uses a hard-coded `id="modal-title"` (`:64,75`), which duplicates IDs when stacked. It renders `null` when closed, so there is no exit transition.
- **Problem.** Stacked overlays are common. The booking drawer opens the Overbook dialog. The consultation opens the Sign & Bill modal, then the PDF preview. The workspace opens the AI scribe, then the append/replace dialog. With no focus management, keyboard and screen-reader users lose their place.
- **Problem.** `body.style.overflow = "unset"` on close (`modal.tsx:38`, `global-search-modal.tsx:60`) re-enables scroll even if another overlay is still open.
- **Problem.** Backdrop click closes data-entry drawers (walk-in, booking, checkout). A mis-tap on a phone discards a half-filled registration.
- **Recommendation.** Use Dialog, Sheet (side), Drawer (bottom sheet on mobile) and AlertDialog from an accessible primitive library. Data-entry sheets do not close on outside click when dirty and ask "Discard changes?". Replace `alert`/`confirm` with AlertDialog and toasts.

### 3.8 Loading and empty states — **P1**

- **Fact.** There are 0 route `loading.tsx` files, 6 `animate-pulse` uses and 51 `animate-spin` spinners. Empty states exist (`EmptyState` is used in 6 files; the queue has its own). Their copy is reasonable.
- **Problem.** Pages like `/cabin` and `/consultation/[id]` await several queries sequentially in the server component. Navigation shows no feedback until all of them finish. On tier-2/3 mobile networks this reads as "the app froze".
- **Recommendation.** `loading.tsx` skeletons per route group that mirror the final layout. `Suspense` boundaries around slow secondary panels (history, AI). Optimistic status changes on queue actions.

### 3.9 Error messages and recovery — **P1**

- **Fact.** Errors are shown as inline red text (e.g. `components/queue/status-actions.tsx:100`), `alert()` (27 sites) or swallowed with `console.error` (`components/layout/global-search-modal.tsx:80`, walk-in search). There are 0 `error.tsx` boundaries.
- **Problem.** Error copy is generic ("Failed to register patient in clinic database."), with no next step. The permission failure in F-01 would surface as a raw thrown message.
- **Recommendation.** Error taxonomy: field errors inline with `aria-describedby`, action errors as an inline Alert at the top of the sheet with a retry, transient errors as a toast, route errors via `error.tsx` with "Try again" and a support reference ID. All business-rule errors (slot taken, outside hours, permission) get specific copy and a recovery action ("Book anyway (overbook)", "Ask admin for access").

### 3.10 Responsive behaviour — **P1**

- **Fact.** The breakpoint prefixes used are `sm:` 241, `md:` 27, `lg:` 50 and `xl:` 7. Layout depends on one breakpoint (`lg`) for the sidebar. The main container is `max-w-7xl` (`components/layout/app-layout-shell.tsx:57`).
- **Problem.** See F-12. Also: the mobile header carries hamburger, search, AI, bell and avatar but hides the clinic name and role. Navigation needs two taps (hamburger, then item) with a full-height drawer. The queue card stacks into a tall block whose actions are icon-only on mobile, with only a `title` (no accessible name; `components/queue/queue-card.tsx:211,221`).
- **Recommendation.** Bottom tab bar under 768 px with a centre "+" action. A list-first calendar (agenda) on phones. Sticky bottom action bars for primary actions in sheets. 44 px minimum targets.

### 3.11 Accessibility — **P1**

> Verification (2026-11-10): PARTIALLY_CONFIRMED — UX-3.11: most counts reproduce; unlabelled-input and colour-only claims not verified; icon-only buttons are an issue only below `sm`. H/P1. See VERIFICATION_LOG.md

| Issue | Evidence | WCAG |
|---|---|---|
| No focus trap or restore in any overlay | 0 focus-management code | 2.4.3, 2.1.2 |
| `div` click handlers without role or keyboard | 10 non-interactive elements with `onClick` and no role (e.g. `components/ui/dropdown.tsx:44` trigger wrapper, `components/patients/patient-visit-history.tsx:192`) | 2.1.1, 4.1.2 |
| Nested interactive `<a><button>` | 26 | 4.1.2 |
| Unlabelled form controls | ~50 inputs, 13 selects, 4 textareas lack an id or aria-label (heuristic) | 1.3.1, 3.3.2 |
| Errors not programmatically associated | `Field` error id is never referenced | 3.3.1 |
| Low-contrast text | 267 × `text-gray-400` (≈2.6:1), `--text-muted #73777D` on canvas is 4.17:1 | 1.4.3 |
| Tiny text | 330 × 9–11 px | 1.4.4 (practical) |
| Tabs without tab semantics | 0 `role="tablist"` | 4.1.2 |
| Comboboxes (drug, diagnosis, patient search) without `role="combobox"`, `aria-activedescendant` or arrow-key support | `components/consultation/prescription-builder.tsx:487-530` | 4.1.2, 2.1.1 |
| Status by colour only (vitals pending amber vs recorded green) | `components/queue/queue-card.tsx:150-170` | 1.4.1 |
| Icon-only buttons that rely on `title` | `queue-card.tsx:204-222`, 8 × `hidden sm:inline` labels | 4.1.2 |
| `<html lang="en">` with no `dir`/language strategy | `app/layout.tsx:15` | 3.1.1 (future i18n) |

### 3.12 Typography, spacing, visual hierarchy — **P2**

- **Fact.** The font stack declares Inter (`app/globals.css:4`), but no `next/font` or stylesheet loads it, so users get Segoe UI, Roboto or San Francisco depending on device. Tabular numerals are used only sometimes (`tabular-nums`).
- **Problem.** Hierarchy relies on weight (`font-bold` everywhere) and uppercase micro-labels rather than size and spacing. Page titles alternate between `text-2xl` and `text-2xl sm:text-3xl`. 11 px uppercase labels are hard to read on a low-DPI 720p Android screen.
- **Recommendation.** A loaded, Devanagari-ready type family (IBM Plex Sans + IBM Plex Sans Devanagari), a 7-step type scale, sentence-case labels and tabular numerals for tokens, times and money (see `DESIGN_SYSTEM.md` §4).

### 3.13 Component reuse and consistency — **P1**

| Concern | Duplicate implementations |
|---|---|
| Patient search UI | 5 (`global-search-modal`, `patient-directory-table`, `walk-in-drawer`, `booking-drawer`, `waitlist-drawer`) |
| Patient creation UI | 5 (`patients/new`, walk-in, booking, waitlist, `ai/quick-registration-card`), with dedup in 1 |
| Status badge mapping | ≥ 8 files |
| Vitals display or entry | 6 (`vitals-block`, `triage-vitals-modal`, `queue-card`, `my-queue-card`, `patient-history-drawer`, `referrals-register`) |
| Billing collection | 2 full flows (`queue/checkout-drawer` 1,029 lines; `consultation/sign-and-bill-modal` 651 lines) plus `billing/receipt-modal` |
| WhatsApp share buttons | 5 files, each with its own sending, sent and error state |
| Drawers | 8 bespoke |

**Recommendation.** Domain components built once on primitives: `PatientPicker`, `QuickRegisterForm`, `StatusChip`, `VitalsSummary` / `VitalsForm`, `CollectPayment`, `ShareButton`. See `DESIGN_SYSTEM.md` §7.

---

## 4. Persona assessment

**Assumption (validate, OI-UX-4).** Personas come from PRD §2.

- Solo doctor: 15–60 patients a day, often on a phone or tablet.
- Receptionist: non-technical, works on a shared desktop or an Android phone.
- Nurse: does vitals.
- Owner/admin: is often the doctor.

### 4.1 Receptionist / front desk (highest-frequency user) — **P0/P1**

| Daily task (est. frequency) | v1 path | v1 problems | v2 target |
|---|---|---|---|
| Check in a booked patient (20–50/day) | Queue → find card → Check In | Not live. Card has no search, so the user scrolls. | Today → type name or token in filter → **Enter**. One action. Row flashes. |
| Walk-in, existing patient (10–40/day) | Queue → + Add Walk-In → type → click result | 3 calls from the browser (F-03). Doctor defaults to the first in the list. | ⌘K or "+" → type phone → **Add to queue** (doctor defaults to the last or least-busy doctor). 2 actions. |
| Walk-in, new patient | Queue → Walk-In → New Patient tab → form | **Fails for receptionist** (F-01). No dedup (F-05). | Same flow. "No match" leads to an inline 4-field quick register, with dedup shown inline. |
| Book appointment (phone call) | Calendar → find slot (desktop-only grid) → drawer → search patient → Book | Free-text time with no slot list. Context dropped from patient profile (F-07). Duplicate patient on overbook (F-04). | Book sheet: patient → doctor → date chips → **available slot chips** → confirm. One sheet. |
| Reschedule or cancel | Calendar → cancel (`confirm()`) → rebook | No staff reschedule (F-06) | Appointment row menu → Reschedule (same slot picker) or Cancel (reason) |
| Collect payment | Queue card → Checkout drawer (1,029-line component) | Non-atomic. `₹1500` formatting. `type=number`. | "Ready to bill" lane on Today → Collect sheet → amount prefilled → Cash/UPI/Card → **Collect**. Receipt share is one tap. |
| Day close | Not available to receptionist | | Collections page (own shift), cash vs UPI totals |

### 4.2 Doctor — **P1**

| Task | v1 path | Problems | v2 target |
|---|---|---|---|
| See who's next | Doctor's Cabin (`components/cabin/doctor-cabin-view.tsx`) | Not live. Waiting/completed tabs. | **My queue** rail, live, with next patient pinned and "Call next" |
| Consult | Cabin → Start → long single-scroll workspace with 7 sections and a jump bar | 15 s autosave with no guard (F-08). Allergy alert is a generic banner. Drug combobox is mouse-only. | Two-pane workspace: left = patient context (allergies, chronic conditions, last Rx, vitals), right = note + Rx. Keyboard-first. Explicit save status. |
| Prescribe | Search → click result → frequency chip → duration chip → Add (about 4 actions per drug, each a server call) | No keyboard path. No allergy cross-check per drug. | Type → ↓/Enter → frequency/duration presets with keyboard → Enter (0 mouse actions). "Repeat last Rx" in one action. |
| Finish | Complete & Sign → Sign & Bill modal → WhatsApp | Billing UI duplicated from the front desk | "Finish visit": sign, then either hand to front desk ("Ready to bill") or collect at the desk (solo clinic setting) |
| Review history | History drawer or patient page tabs | Tabs not addressable by URL | Timeline in left pane plus full history route |

### 4.3 Clinic admin / owner — **P2**

- **Fact.** Admin pages are Staff, Clinic Profile, Billing & Reports and Developer Settings. Developer settings (API keys and webhooks) sit at the same level as daily items.
- **Problem.** Doctor availability lives under the personal profile (`components/profile/doctor-availability-card.tsx`). Admins cannot manage other doctors' schedules from one place. **Assumption (validate):** check whether `features/settings` allows admin edits of other doctors.
- **Recommendation.** Group admin items under Settings (Clinic, Team, Schedules, Billing & plan, Integrations) and give owners an **Overview** page. Keep it out of the front desk's way.

### 4.4 Nurse — **P2**

- Nurses use queue triage (`components/queue/triage-vitals-modal.tsx`). v2 adds a **Triage mode** on Today: a filter for "vitals pending" and a vitals sheet with large numeric inputs and range hints.

---

## 5. B6 critical workflow redesign

Each workflow covers: (1) existing implementation, (2) usability problems, (3) proposed interaction model, (4) redesigned interface, (5) business requirements validated (PRD refs), (6) API and backend dependencies.

Click counts assume desktop with a mouse and an existing session. "Action" means a click, tap or Enter. Typing is not counted.

### 5.0 Global shell and navigation

**(1) Existing.** `components/layout/app-layout-shell.tsx`, `app-sidebar.tsx`, `app-header.tsx`, `global-search-modal.tsx`, `user-dropdown.tsx`, `notification-bell.tsx`, `operations-copilot-drawer.tsx`.

**(2) Problems.** See §3.2 and §3.10:

- a collapsible 288/80 px sidebar;
- a two-tap hamburger on mobile;
- unconventional ⌘K;
- the AI SDK loaded on every page;
- the clinic name hidden on mobile;
- no current-date or clinic-status context.

**(3) Interaction model.**

- Desktop at 1280 px and above: a fixed 232 px sidebar.
- Tablet (768–1279 px): a 64 px icon rail with labels in tooltips.
- Phone (under 768 px): a top bar plus a bottom tab bar with 4 destinations and a centre "+".
- ⌘K or the top search field opens the **command palette**.
- "+" opens the **Quick actions** sheet: Walk-in, Book, Register, Collect.

**(4) Wireframes.**

```
DESKTOP ≥1280                                                         
┌──────────────┬──────────────────────────────────────────────────────────────────┐
│ ◉ Sharma     │  Today · Tue 10 Nov        [ 🔍 Find patient, phone, token…  ⌘K ]  🔔  (SK) │
│   Clinic     ├──────────────────────────────────────────────────────────────────┤
│              │                                                                  │
│ ▣ Today    ● │                                                                  │
│ ▢ Schedule   │                     page content (fluid, max 1440)               │
│ ▢ Patients   │                                                                  │
│ ▢ Collections│                                                                  │
│              │                                                                  │
│ ─────────    │                                                                  │
│ ▢ Reports *  │                                                                  │
│ ▢ Settings * │                                                                  │
│              │                                                                  │
│ [+ New  ▾]   │  * owner/admin only                                              │
│ Dr. A Rao ▾  │                                                                  │
└──────────────┴──────────────────────────────────────────────────────────────────┘

PHONE <768
┌───────────────────────────────┐
│ Sharma Clinic        🔍  🔔 (SK)│  ← 56px top bar; 🔍 opens palette full-screen
├───────────────────────────────┤
│                               │
│        page content           │
│                               │
│                               │
├───────────────────────────────┤
│  ▣      ▢      (+)     ▢    ≡ │  ← 64px bottom bar, safe-area aware
│ Today Schedule  New Patients More│
└───────────────────────────────┘
```

**(5) Business requirements.** PRD §3.1 (zero-training; under 3 taps), §3.2 (run the clinic from a phone), §4.1 (role-based access).

**(6) Dependencies.** No backend change. Role is already resolved in `app/(dashboard)/layout.tsx`. The palette needs the search endpoint (5.7).

---

### 5.1 Patient registration

**(1) Existing.** `app/(dashboard)/patients/new/page.tsx` (client page, 353 lines, with dedup). Parallel variants live in `queue/walk-in-drawer.tsx`, `calendar/booking-drawer.tsx`, `calendar/waitlist-drawer.tsx` and `ai/quick-registration-card.tsx`. Server: `features/patients/actions.ts:16 createPatient`, `features/patients/dedup.ts:29 findPotentialDuplicates`.

**(2) Problems.**

- F-01 (receptionist permission).
- F-05 (dedup in only 1 of 5 flows).
- No allergies at registration.
- Full-page form with address fields that front desk rarely needs at the counter.
- Success navigates to the profile, but the next step is almost always "add to queue" or "book".

Clicks: Patients → Register → fill → Save → (profile) → Add to Queue (context lost, F-07) → Add Walk-in → search again → select. That is about 7 actions plus retyping.

**(3) Interaction model.** One **QuickRegister** component used everywhere:

- Essential fields: name, mobile, age-or-DOB, sex.
- Optional disclosure: allergies, address, ABHA, emergency contact.
- Live duplicate check inline as name and phone are entered ("Possible match: Ramesh Kumar, 42 M, ••• 43210, last visit 12 Oct — **Use this patient**").
- The primary action is contextual: **Register & add to queue**, **Register & book**, or **Register only**.
- After saving, the user stays in flow.

**(4) Wireframe (sheet, mobile and desktop share it).**

```
┌ New patient ──────────────────────────────── ✕ ┐
│ Mobile number *                                 │
│ [+91 │ 98765 43210            ]                 │
│ ┌ ⚠ Possible existing patient ───────────────┐  │
│ │ Ramesh Kumar · 42 M · last visit 12 Oct    │  │
│ │                     [ Use this patient ]   │  │
│ └────────────────────────────────────────────┘  │
│ Full name *                                     │
│ [ Ramesh Kumar                         ]        │
│ Age or date of birth *        Sex *             │
│ [ 42 ] yrs  or [ dd/mm/yyyy ] (M)(F)(Other)     │
│ Allergies                                       │
│ [ + Add allergy ]   ( ) No known allergies      │
│ ▸ More details (address, ABHA, emergency)       │
├─────────────────────────────────────────────────┤
│ Doctor  [ Dr. A Rao ▾ ]   Reason [ Fever     ]  │  ← shown in walk-in context
│        [ Register only ]  [ Register & add to queue ▸ ] │
└─────────────────────────────────────────────────┘
```

Target: 1 action to open, plus typing, plus 1 action to commit. Total 2 actions.

**(5) Business requirements.** PRD §4.3 (dedup by name + phone + DOB fuzzy; unified profile with allergies), §3.1. **Assumption (validate):** receptionists *should* be able to create patients (PRD persona: "managing walk-ins"). If not, the UI must hide creation and offer "Ask nurse/doctor". That would be a poor experience.

**(6) Dependencies.**

- Permission decision (F-01).
- **Atomic RPC** `register_patient_and_enqueue(patient, doctor_id, reason, origin)` and `register_patient_and_book(…)`, returning `{patient_id, visit_id, token}`.
- Idempotency key per submit, to prevent double-tap duplicates.
- Dedup endpoint returning a minimal projection.
- Allergy field on the create payload (exists in `patientSchema`).

---

### 5.2 Appointment booking

**(1) Existing.** `app/(dashboard)/calendar/page.tsx` → `components/calendar/calendar-view.tsx` (521 lines) → `doctor-timeline.tsx` (day grid, multi-doctor columns, `min-w-[780px]`). Booking uses `booking-drawer.tsx`, which calls `bookAppointment` (`features/visits/scheduling.ts`). Overbook and soft-block go through `overbook-dialog.tsx` and `soft-block-override-dialog.tsx`. There are also a waitlist drawer and a block-time modal.

**(2) Problems.**

- Day view only.
- Slot grid is desktop-only.
- The booking drawer takes a free `type="time"` value, not available slots.
- "Book Slot" from the profile drops the patient (F-07).
- Duplicate patient on overbook (F-04).
- `new Date(\`${date}T${time}:00\`)` uses the browser's time zone (`booking-drawer.tsx:182`), which is wrong if a staff device is not set to IST.
- Hover-only slot hints are invisible on touch.

Clicks (existing patient, from calendar): Calendar → slot → type search → select → Book = 4 actions. From the patient profile: plus re-search = 6.

**(3) Interaction model.**

- Booking is a **sheet**, launched from anywhere (palette, profile, Today, Schedule slot).
- It is pre-filled with whatever context exists (patient, doctor, time).
- Steps run inline, not as a wizard: Patient → Doctor → Day → Slot.
- Slots are chips computed server-side from the doctor's availability, blocks and existing bookings.
- Taken slots are hidden by default. "Show full slots" lets the user overbook explicitly, with reason capture.
- Schedule view: agenda list on phones, multi-doctor day grid on desktop, week view per doctor.

**(4) Wireframe.**

```
┌ Book appointment ─────────────────────────────────── ✕ ┐
│ Patient   [ Ramesh Kumar · 42 M · ••• 43210     ✎ ]    │
│ Doctor    (● Dr. A Rao)  ( Dr. S Iyer )                │
│ Day       [Today 10]  [Wed 11]  [Thu 12]  [Fri 13]  📅 │
│ Morning   (09:00)(09:15)(09:30)(10:15)(10:30)          │
│ Evening   (17:00)(17:15)(17:45)(18:00)                 │
│           ☐ Show booked/blocked slots (overbook)       │
│ Reason    [ Follow-up BP                     ]         │
│ Notify    ☑ WhatsApp confirmation to patient           │
├────────────────────────────────────────────────────────┤
│ Thu 12 Nov · 09:30 am · 15 min        [ Book ▸ ]       │  ← sticky summary bar
└────────────────────────────────────────────────────────┘
```

Target: 3 actions with context (slot, Book), 4 without.

**(5) Business requirements.** PRD §4.2:

- per-doctor slots, hours, breaks and leave;
- double-booking prevention with configurable overbook;
- waitlist;
- reminders.

Recurring appointments (PRD §4.2) are not implemented in v1. **Recommendation:** P3, a "Repeat weekly × N" toggle in the same sheet, after backend support.

**(6) Dependencies.**

- `GET available slots (doctor, date range)` server function (logic partly exists in `features/visits/scheduling.ts` and `scheduling-utils.ts`).
- `bookAppointment` to accept an idempotency key and an inline new patient atomically.
- Tenant time zone (default `Asia/Kolkata`) on the server.
- WhatsApp confirmation trigger (exists via notifications).

---

### 5.3 Appointment rescheduling and cancellation

**(1) Existing.** Staff can cancel only, via `cancelVisit` with `confirm()` and `alert()` (`components/calendar/calendar-view.tsx:185-200`), and get a waitlist auto-promotion notice. Reschedule exists for patients only (`app/reschedule/[token]`, `app/api/reschedule/[token]/route.ts:233`) and via inbound WhatsApp (`app/api/webhooks/messaging/[provider]/route.ts:395`). No-show has no explicit staff action in queue or calendar (`status-actions.tsx` has none).

**(2) Problems.** F-06. Cancel captures no reason. The patient is not offered a reschedule message. No undo.

**(3) Interaction model.** The appointment row or card has an overflow menu (`⋯`) with:

- **Reschedule**: the booking sheet in reschedule mode, keeping the patient, doctor and reason;
- **Cancel**: an AlertDialog with a reason chip (Patient request / Doctor unavailable / Duplicate / Other) and "Send WhatsApp with reschedule link" checked by default;
- **Mark no-show**: allowed only after the slot time.

Destructive actions show a toast with **Undo** for 8 s where the backend allows.

**(4) Wireframe.**

```
 09:30  Ramesh Kumar · 42 M   Booked   Dr. Rao   [Check in] [⋯]
                                                     ┌──────────────┐
                                                     │ Reschedule   │
                                                     │ Mark no-show │
                                                     │ Cancel…      │
                                                     └──────────────┘
┌ Cancel appointment? ───────────────────────────┐
│ Ramesh Kumar · Thu 12 Nov, 09:30 am · Dr. Rao  │
│ Reason  (Patient request)(Doctor unavailable)  │
│         (Duplicate)(Other…)                    │
│ ☑ Send WhatsApp with reschedule link           │
│              [ Keep ]   [ Cancel appointment ] │
└────────────────────────────────────────────────┘
```

Reschedule target: 3 actions (⋯ → Reschedule → slot → Confirm = 4).

**(5) Business requirements.** PRD §4.2 states (Rescheduled, No-show, Cancelled), waitlist auto-notify.

**(6) Dependencies.**

- Expose `rescheduleAppointment` (`features/appointments/actions.ts:151`) to staff with an `appointments:edit` guard.
- `cancelVisit` to accept a reason.
- A no-show transition.
- Generate a reschedule token for the WhatsApp link (`generateRescheduleToken` exists, `:390`).

---

### 5.4 Walk-in registration and queue management (front-desk "Today")

**(1) Existing.**

- `app/(dashboard)/queue/page.tsx` → `components/queue/queue-view.tsx`, `queue-card.tsx`, `status-actions.tsx`, `walk-in-drawer.tsx`, `triage-vitals-modal.tsx`, `checkout-drawer.tsx`.
- Server: `features/queue/actions.ts` (`checkInVisit`, `transitionQueueState`, `getQueueForDate`).
- Dashboard (`app/(dashboard)/page.tsx`) duplicates a subset.

**(2) Problems.**

- F-02 (not live) and F-03 (non-atomic).
- Single long card list, no search or filter beyond doctor.
- No grouping by state, so "who's next" is not obvious.
- Start Consultation is offered to the front desk.
- No reordering or priority (emergency / elderly).
- No cancel or no-show.
- Token displayed as `#07` inside a grey box that reads like an avatar.
- Four counter tiles take the top fold on mobile.

**(3) Interaction model.** Today is a single live board:

- **Lanes** by state: *Booked (not arrived)*, *Waiting*, *With doctor*, *Ready to bill*, *Done*.
- On desktop, lanes are columns of compact rows. On phones, they are a segmented control with counts.
- A filter box at the top accepts token number, name or phone. Enter on a single match does the primary action for that row's state: Check in, Collect or Open.
- Doctor filter chips, with "All" and per-doctor counts.
- **Live**: Supabase Realtime on `visits` and `queue_tokens` for the tenant and date, with a 15 s polling fallback and a "Live" or "Reconnecting…" indicator.
- Row actions by role:
  - Front desk: Check in, Vitals, Collect, ⋯ (Reschedule, No-show, Cancel, Move doctor).
  - Doctor: Call, Open.
  - Nurse: Vitals.
- Walk-in is the "+ Walk-in" button or the `W` key, which opens the PatientPicker plus QuickRegister.

**(4) Wireframe (desktop).**

```
┌ Today · Tue 10 Nov ───────────────────────────────── ● Live ─────────────────────┐
│ [ 🔍 Token, name or phone…            ]  Doctors: (All 34)(Dr Rao 21)(Dr Iyer 13) │
│                                                     [ + Walk-in  W ] [ Book  B ] │
├──────────────────┬──────────────────┬─────────────────┬──────────────┬──────────┤
│ BOOKED · 9       │ WAITING · 6      │ WITH DOCTOR · 2 │ TO BILL · 3  │ DONE · 14│
├──────────────────┼──────────────────┼─────────────────┼──────────────┼──────────┤
│ 10:30 Anita S    │ ┃14┃ Ramesh K 42M │ ┃12┃ Sunita P  │ ┃11┃ Arjun M  │ ┃09┃ …   │
│ 34F · Dr Rao     │ Walk-in · 18 min │ Dr Rao · 07 min │ ₹500 due     │          │
│ [Check in] ⋯     │ ♥ BP 150/95  ⚠PCN│                 │ [Collect]    │          │
│ 10:45 Vikram T   │ [Vitals] ⋯       │                 │              │          │
│ 51M · Dr Iyer    │ ┃15┃ Fatima B 29F │ ┃13┃ Joseph D  │ ┃10┃ …       │          │
│ [Check in] ⋯     │ Appt 10:15 · 6min│ Dr Iyer · 02 min│              │          │
│ …                │ ♥ Vitals pending │                 │              │          │
└──────────────────┴──────────────────┴─────────────────┴──────────────┴──────────┘
  ┃14┃ = token chip (tabular, high contrast)  ⚠PCN = allergy chip  ♥ = vitals summary
```

```
PHONE
┌───────────────────────────────┐
│ Today · Tue 10 Nov     ● Live │
│ [🔍 Token, name, phone      ] │
│ (Booked 9)(Waiting 6)(Doctor 2)(Bill 3)│ ← scrollable segmented control
├───────────────────────────────┤
│ ┃14┃ Ramesh Kumar      18 min │
│      42 M · Dr Rao · Walk-in  │
│      ♥ BP 150/95   ⚠ Penicillin│
│      [ Vitals ]        [ ⋯ ]  │
├───────────────────────────────┤
│ ┃15┃ Fatima Begum       6 min │
│      29 F · Dr Iyer · 10:15   │
│      ♥ Vitals pending         │
│      [ Vitals ]        [ ⋯ ]  │
├───────────────────────────────┤
│ ▣Today ▢Schedule (+) ▢Patients ≡│
└───────────────────────────────┘
```

Walk-in for an existing patient: `W` → type phone → Enter (selects the top match) → Enter (Add to queue) = 3 keystrokes and no mouse. Check-in: type token → Enter = 1 action.

**(5) Business requirements.** PRD §4.2 (walk-in tokens alongside scheduled appointments in the same view; states), PRD §2 (receptionist: queue view, payment collection), PRD §5.2 (offline-tolerant queue: *validate feasibility*. Recommendation P3: cache the last board read-only with a "stale since hh:mm" banner).

**(6) Dependencies.**

- Supabase Realtime publication on `visits` and `queue_tokens` with RLS-safe tenant filter (Workstream C/D to validate RLS with Realtime).
- Atomic `enqueue_walk_in` RPC.
- Transitions: `no_show`, `ready_to_bill` (or derive "to bill" from `completed` and unpaid invoice; **Assumption (validate)** whether a new state is needed or a derived lane is enough).
- Role-checked transitions server-side (`in_consultation` only by doctor/owner).
- Token priority flag (P3).

---

### 5.5 Patient search and retrieval (command palette)

**(1) Existing.** `components/layout/global-search-modal.tsx` (shortcut `/` or ⌘/) calls the `searchPatients` server action with a 250 ms debounce and a `select("*")` result. Each result navigates to the profile only. Four other components each implement their own search.

**(2) Problems.**

- Over-fetching PII.
- No ranking.
- No action shortcuts from results.
- Errors swallowed.
- No focus trap.
- Shortcut conflicts with typing "/" in some contexts.
- Results show the full phone number on a shared front-desk screen. **Risk:** shoulder-surfing. Workstream D to decide on masking.

**(3) Interaction model.**

- ⌘K / Ctrl+K anywhere, or the top-bar search (full-screen on phones).
- Results are grouped: **Patients** (ranked: exact phone, then token today, then name trigram), **Today's queue** matches, then **Actions** (New patient, Walk-in, Book, Go to …, Ask AI…).
- Each patient row has inline secondary actions via `Tab` or `→`: Add to queue, Book, Open, Collect.
- Recent patients appear when the query is empty.

**(4) Wireframe.**

```
┌──────────────────────────────────────────────────────────────┐
│ 🔍 9876                                                 esc  │
├──────────────────────────────────────────────────────────────┤
│ PATIENTS                                                     │
│ ▶ Ramesh Kumar      42 M   ••• ••• 76543   Last: 12 Oct      │
│      ↳ [Add to queue ⏎] [Book ⌘⏎] [Open →]                   │
│   Rekha Kumari      37 F   ••• ••• 76501   Last: 02 Sep      │
│   Raju (Baby of Rekha) 8 m F ••• ••• 76501  Last: 02 Sep      │
│ IN TODAY'S QUEUE                                             │
│   ┃14┃ Ramesh Kumar · Waiting 18 min · Dr Rao                │
│ ACTIONS                                                      │
│   ＋ Register "9876…" as new patient                         │
│   ✦ Ask Copilot: "9876"                                      │
├──────────────────────────────────────────────────────────────┤
│ ↑↓ navigate  ⏎ primary  ⌘⏎ book  → more   Shared phone? Shows family members │
└──────────────────────────────────────────────────────────────┘
```

**(5) Business requirements.** PRD §4.3 search by name, phone, patient ID, ABHA. Shared family phone numbers are common in India, so results must show age and sex to disambiguate (already partly handled in `components/ai/patient-disambiguation-card.tsx`).

**(6) Dependencies.**

- GET route handler `/api/search?q=` (cancellable with `AbortController`, unlike server actions) returning a minimal projection.
- `pg_trgm` index on `full_name` and a normalized phone column (Workstream C).
- Audit "patient record viewed" on open, not on search (Workstream D).

---

### 5.6 Patient history (patient profile)

**(1) Existing.** `app/(dashboard)/patients/[id]/page.tsx` → `components/patients/patient-detail-view.tsx` (631 lines). Client tabs: visits, profile, consent, labs. `patient-visit-history.tsx` (640), `patient-lab-documents.tsx` (684), `consent-section.tsx`, `dpdp-export-actions.tsx`.

**(2) Problems.**

- Tabs are not URL-addressable and lack tab semantics.
- The header shows actions (Edit, Book Slot, Refer, Add to Queue), but two of them drop context (F-07).
- Allergies and chronic conditions are not in a persistent identity header.
- Visit history is a long expandable list. There is no filter by doctor, type or date (PRD §4.3 asks for filterable history).
- WhatsApp resend failures use `alert()`.

**(3) Interaction model.**

- A persistent **PatientIdentityHeader** (name, age/sex, ID, phone, allergies, chronic conditions, alerts) with primary actions that keep context: **Add to queue** (opens the doctor/reason popover inline) and **Book** (opens the booking sheet with the patient prefilled).
- Sub-routes: Timeline (default), Prescriptions, Documents, Profile, Consent and privacy.
- The timeline is filterable by doctor, type and date. Each entry shows diagnosis, Rx summary and amount paid, with actions: View, Reprint, Share, Repeat Rx (doctor).

**(4) Wireframe.**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ (RK) Ramesh Kumar  42 M · ID CQ-0042 · +91 98765 43210        [Add to queue][Book][⋯]│
│ ⚠ Allergies: Penicillin, Sulfa      Chronic: T2DM, HTN    Last visit 12 Oct (Dr Rao) │
├──────────────────────────────────────────────────────────────────────────────┤
│ Timeline · Prescriptions · Documents · Profile · Consent                      │
├──────────────────────────────────────────────────────────────────────────────┤
│ Filters: [All doctors ▾] [All types ▾] [Last 12 months ▾]                     │
│ 12 Oct 2026 · Dr A Rao · OPD                                     ₹500 paid    │
│   Dx: Essential hypertension (I10)                                            │
│   Rx: Telmisartan 40 mg 1-0-0 × 30d · Metformin 500 mg 1-0-1 × 30d            │
│   [View] [Reprint] [Share on WhatsApp] [Repeat Rx]                            │
│ 02 Sep 2026 · Dr S Iyer · Follow-up                              ₹300 paid    │
│   …                                                                           │
└──────────────────────────────────────────────────────────────────────────────┘
```

**(5) Business requirements.** PRD §4.3 (unified record; filterable chronological history), §4.5 (prescription history re-printable), DPDP consent and export (`features/dpdp`).

**(6) Dependencies.**

- `getPatientVisitHistory` (`features/patients/actions.ts:299`) to support filters and pagination.
- Signed-URL reprint (exists).
- Inline enqueue uses the walk-in RPC with an existing `patient_id`.

---

### 5.7 Doctor consultation workflow

**(1) Existing.**

- `app/(dashboard)/consultation/[id]/page.tsx` → `components/consultation/consultation-workspace.tsx` (1,681 lines).
- Sections: Vitals, Complaints and notes, Specialty exam (dental odontogram, paediatrics, GP systemic review), Diagnosis (ICD), Prescription, Investigations and advice, Follow-up, referral and attachments.
- Plus: sticky header, section jump bar, Clinical Copilot panel (docked or slide-over), AI Scribe modal, history drawer, Sign & Bill modal.
- Saves via `saveConsultationDraft` (15 s debounce) and `completeAndSignConsultation` / `completeAndBillConsultation`.

**(2) Problems.**

- F-08 (save model; no-op upload).
- One very long scroll on a phone.
- Patient context (last Rx, chronic conditions) lives in a drawer, not in view.
- Comboboxes are mouse-centric.
- Specialty switcher in the header. **Assumption:** this rarely changes per visit; it should default from the doctor profile.
- Header crowded with Copilot, History, Save Draft and Complete & Sign.
- The monolith makes regressions likely.

Prescribing 3 drugs takes about 12 actions plus 3 server round-trips.

**(3) Interaction model.** A **two-pane, keyboard-first workspace**:

- **Left pane (context, read-only):** identity header, allergy banner, today's vitals (editable inline), problem list, last visit summary and last Rx with "Repeat", and the docs list.
- **Right pane (document):** a single note with structured blocks in clinical order: Complaints → Exam (specialty template) → Diagnosis → Rx → Investigations → Advice → Follow-up.
- Each block is collapsible and has a keyboard shortcut (`Alt+1…7`).
- **Save model:** local draft on every change (IndexedDB, per visit), a server save on blur and every 5 s idle, a header status of "Saved · 10:42" / "Saving…" / "Offline — saved on this device", and a navigation guard if a server save is pending.
- **Rx entry:** type → ↓/⏎ select → frequency preset by number keys (1 = 1-0-1, 2 = 1-0-0 …) → duration (`5d`, `1w`) → ⏎ adds. A per-drug **allergy check chip** warns inline if the drug's salt matches a recorded allergy (backend dependency).
- **Finish visit** (one primary button) opens a review sheet: summary, print or WhatsApp toggle, and billing hand-off (front desk) or collect-now (solo mode, a clinic setting).
- AI Scribe and Copilot sit in a right-edge **Assist** panel, collapsed by default. AI output is inserted as "AI-suggested" blocks that need accept (PRD §3.5).

**(4) Wireframe (desktop ≥1280; tablet collapses the left pane to a drawer).**

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ← Queue  ┃14┃ Ramesh Kumar 42 M · CQ-0042      Saved · 10:42  [Assist ✦] [Finish visit ▸]│
│ ⛔ ALLERGY: Penicillin, Sulfa  ·  Chronic: T2DM, HTN                                    │
├────────────────────────────┬─────────────────────────────────────────────────────────┤
│ VITALS (today)        ✎    │ Complaints                                        Alt+1 │
│ BP 150/95  P 88  T 98.6°F  │ [ Headache × 3 days ] [ Giddiness ] [+]                 │
│ SpO₂ 98%  Wt 78 kg  BMI 27 │ Notes  ┌──────────────────────────────────────────────┐ │
│                            │        │ c/o throbbing occipital headache…            │ │
│ LAST VISIT · 12 Oct        │        └──────────────────────────────────────────────┘ │
│ Dx I10 Essential HTN       │ Diagnosis                                         Alt+3 │
│ Rx Telmisartan 40 1-0-0    │ [ I10 Essential hypertension ✕ ] [ Search ICD… ]        │
│    Metformin 500 1-0-1     │ Prescription                                      Alt+4 │
│ [ Repeat last Rx ]         │ ┌──────────────────────────────────────────────────────┐│
│                            │ │1 Telmisartan 40 mg tab   1-0-0  30 d  after food  ✕ ││
│ HISTORY                    │ │2 Amlodipine 5 mg tab     0-0-1  30 d               ✕ ││
│ 12 Oct · Dr Rao · ₹500     │ │  [ Search medicine…  (↓ select · 1-4 freq · ⏎ add) ] ││
│ 02 Sep · Dr Iyer · ₹300    │ └──────────────────────────────────────────────────────┘│
│ [ Full history → ]         │ Investigations  [CBC][Lipid][HbA1c][+]           Alt+5 │
│                            │ Advice  [Low salt][Walk 30 min][+]               Alt+6 │
│ DOCUMENTS                  │ Follow-up  (3 d)(1 w)(●2 w)(1 m)  → Tue 24 Nov    Alt+7 │
│ CBC 10 Oct.pdf             │                                                         │
└────────────────────────────┴─────────────────────────────────────────────────────────┘
```

```
PHONE (single column; context collapses into the header)
┌───────────────────────────────┐
│ ← ┃14┃ Ramesh K 42M   Saved ✓ │
│ ⛔ Penicillin, Sulfa  ▸ context│  ← tap opens context sheet (vitals, last Rx)
├───────────────────────────────┤
│ Complaints ▾                  │
│ Diagnosis ▾                   │
│ Prescription ▾ (2)            │
│ …                             │
├───────────────────────────────┤
│ [ Assist ✦ ]   [ Finish visit ]│  ← sticky bottom bar
└───────────────────────────────┘
```

**(5) Business requirements.**

- PRD §2: fast prescription writing, minimal typing, phone or tablet use.
- PRD §3.5: AI is assistive and clearly marked.
- PRD §4.5: e-prescription, history, never silently overwritten. Amendment flow exists: `reopenVisitForAmendment`, `finalizeVisitAmendment`.
- Specialty templates (dental, paediatrics, GP) are retained.

**(6) Dependencies.**

- Keep `saveConsultationDraft` but make it idempotent and versioned (optimistic concurrency, to avoid two tabs overwriting each other).
- Batch Rx item writes into the draft save instead of per-item calls (or keep per-item with optimistic UI).
- Drug–allergy check (salt mapping in CDCI data; Workstream C).
- Real document upload in the consult (reuse `features/labs` S3 flow) or remove the dropzone.
- `completeAndSignConsultation` to return a hand-off state for billing.

---

### 5.8 Prescription creation

Covered in 5.7. Additional points:

- **Fact.** Protocol templates exist (`saveDoctorProtocolTemplate`, `getDoctorProtocolTemplates`) along with deterministic "frequent Rx" chips (`frequent-rx-chips.tsx`). These are strong features and should stay.
- **Problem.** The Rx PDF preview (`pdf-preview-modal.tsx`) is a modal inside a modal flow. Print requires the PDF route.
- **Recommendation.** An Rx line-item component spec (`DESIGN_SYSTEM.md` §7.6). Templates appear as a "⚡ Templates" menu in the Rx block. On Finish, there is a print-optimised HTML preview with "Print" (browser print with an `@media print` stylesheet). The PDF is generated server-side for WhatsApp only. **Assumption (validate):** many clinics print on A5 or letterhead, so a print-margin setting is needed (P2).
- **Dependencies:** existing `features/prescriptions/*`. Letterhead settings in clinic profile.

---

### 5.9 Billing and payment collection

**(1) Existing.**

- Front desk: `components/queue/checkout-drawer.tsx` (1,029 lines). Consultation fee, quick procedure fees, discount, line items via `addInvoiceItem`/`deleteInvoiceItem`, then `createVisitInvoice`, `recordPayment` and `transitionQueueState("completed")` from the client, then a WhatsApp receipt.
- Doctor: `components/consultation/sign-and-bill-modal.tsx` (651 lines), which calls `completeAndBillConsultation` (server-side composite).
- Reports: `components/billing/collection-reports-view.tsx` (owner/admin).

**(2) Problems.**

- F-03 (non-atomic).
- Two divergent billing UIs.
- `₹` concatenation without grouping.
- `type=number` inputs.
- Payment method buttons lack `aria-pressed` or radio semantics.
- No partial-payment or dues view for the front desk (the drawer computes `balanceDue` but there is no dues list).
- No day-close for the receptionist.

Clicks: Checkout → (fee prefilled?) → method → Collect → Share = 4 actions. That is acceptable. The UI weight (1,029-line drawer) is the issue.

**(3) Interaction model.**

- One **CollectPayment** sheet, used from Today's "To bill" lane, the patient profile (dues) and the consult Finish (solo mode).
- Invoice lines: consultation fee (default from doctor or clinic) plus procedure quick-adds plus a free line.
- Discount as ₹ or %, with a reason when above a threshold (**Assumption**: owner-configurable).
- Payment as a segmented radio group: Cash / UPI / Card / Split. UPI shows the clinic QR (P2; needs the clinic VPA in settings) and a UTR field (optional).
- **Collect** commits everything in one server transaction and returns the receipt.
- Success state: "₹500 received · Receipt CQ/26-27/00123" with [Print] [WhatsApp] [Done].

**(4) Wireframe.**

```
┌ Collect payment ─────────────────────────────── ✕ ┐
│ ┃11┃ Arjun Mehta · 35 M · Dr A Rao · Visit 10:05  │
├───────────────────────────────────────────────────┤
│ Consultation fee                        ₹500.00   │
│ ECG                                      ₹250.00 ✕ │
│ [+ Dressing ₹150] [+ Injection ₹100] [+ Custom]   │
│ Discount   [ ₹ │ 50      ]  ( ₹ | % )             │
│ ─────────────────────────────────────────────     │
│ Total                                  ₹700.00    │
├───────────────────────────────────────────────────┤
│ Paid by   (● Cash) ( UPI ) ( Card ) ( Split )     │
│ Amount received [ ₹ │ 700      ]   Change ₹0     │
├───────────────────────────────────────────────────┤
│ [ Save as due ]              [ Collect ₹700 ▸ ]   │
└───────────────────────────────────────────────────┘
Success:
┌───────────────────────────────────────────────────┐
│ ✓ ₹700 received (Cash) · Receipt CQ/26-27/00123   │
│ [ Print ]  [ Send on WhatsApp ]        [ Done ]   │
└───────────────────────────────────────────────────┘
```

**(5) Business requirements.**

- PRD §2: receptionist payment collection.
- PRD §4.10 Billing & Invoicing.
- **Assumption (validate):** GST is generally not applicable to clinical consultation (healthcare services exemption), but receipts may need the clinic's statutory fields. `components/settings/statutory-fields-card.tsx` exists. Confirm with Workstream A and D.

**(6) Dependencies.**

- **Single RPC** `collect_payment(visit_id, items[], discount, payments[], idempotency_key)` that creates or updates the invoice, records payments and transitions the visit atomically.
- Money as integer paise end to end (Workstream C to verify the current column types).
- Receipt numbering per financial year (verify the existing format).
- Dues query for the profile and for Today.

---

## 6. Prioritised UX backlog (feeds the master roadmap)

| ID | Item | Priority | Size | Depends on |
|---|---|---|---|---|
| UX-01 | Decide receptionist permissions and align UI and RBAC (F-01) | P0 | S | Product owner, Workstream D |
| UX-02 | Atomic RPCs: walk-in, register+book, collect payment (F-03/F-04) | P1 | M | Workstream C |
| UX-03 | Live Today board (Realtime + fallback) replacing Dashboard and Queue (F-02) | P1 | L | UX-02, Realtime RLS validation |
| UX-04 | Design tokens + primitives (DESIGN_SYSTEM) | P1 | L | Tech decision |
| UX-05 | Shell, IA, command palette, bottom nav | P1 | M | UX-04, search endpoint |
| UX-06 | Unified PatientPicker + QuickRegister with dedup everywhere (F-05) | P1 | M | Dedup endpoint |
| UX-07 | Booking sheet with slot chips; staff reschedule / cancel / no-show (F-06) | P1 | L | Slots API, reschedule exposure |
| UX-08 | Consultation workspace rebuild with save model and Rx keyboard flow (F-08) | P1 | XL | Draft versioning |
| UX-09 | CollectPayment unification, en-IN money | P1 | M | UX-02 |
| UX-10 | Patient profile with identity header, sub-routes, filterable timeline (F-07) | P2 | M | History pagination |
| UX-11 | Route loading/error/not-found, toasts, AlertDialog (replace 27 alert/confirm) | P1 | S | UX-04 |
| UX-12 | Date/time/money formatting library (IST-aware) and replace 29 UTC "today" sites | P1 | S | Tenant time zone |
| UX-13 | Paginated registers (patients, visits, referrals, collections) with URL filters | P2 | M | Server pagination |
| UX-14 | Admin Settings regroup, Overview page, receptionist Collections | P2 | M | |
| UX-15 | Print stylesheet and letterhead for Rx and receipt | P2 | S | |
| UX-16 | Drug–allergy inline check | P2 | M | CDCI salt mapping |
| UX-17 | Offline read-only Today plus local consult drafts | P3 | M | |
| UX-18 | Hindi or regional UI (i18n scaffolding only in v2) | P3 | M | Product decision (PRD §10 lists regional-language UI as out of scope "unless specified") |

---

## Appendix A — reproducible metric commands

Run from the repo root under `bash` (not zsh, because of glob expansion). The include flag is `--include='*.tsx'`.

```bash
grep -rEo '\[#[0-9A-Fa-f]{3,8}' app components --include='*.tsx' | wc -l          # 937
grep -rEoh 'text-\[[0-9.]+(px|rem)\]' app components --include='*.tsx' | wc -l    # 330
grep -rn 'var(--' app components --include='*.tsx' | wc -l                        # 0
grep -rl '^.use client' app components --include='*.tsx' | wc -l                  # 90
grep -rl 'fixed inset-0' app components --include='*.tsx' | wc -l                 # 23
grep -rnE '\b(window\.)?(confirm|alert)\(' app components --include='*.tsx' | wc -l # 27
grep -rn -A2 '<Link' app components --include='*.tsx' | grep -c '<Button'         # 26
grep -rnE 'toISOString\(\)\.(split\("T"\)\[0\]|slice\(0, ?10\))' app components features lib --include='*.ts*' | wc -l  # 29
find app -name loading.tsx -o -name error.tsx -o -name not-found.tsx | wc -l     # 0
```
