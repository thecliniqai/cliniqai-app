# clinicOS v2.0 — Information Architecture

| | |
|---|---|
| Date | 2026-11-10 · discovery only, nothing implemented |
| Inputs | `app/` route tree, `components/layout/app-sidebar.tsx`, `lib/permissions/matrix.ts`, `docs/clinic-management-prd.md` §2, §4 |
| Related | `UX_AUDIT.md` §3.2, §5.0 · `DESIGN_SYSTEM.md` §7.1 · `FRONTEND_MIGRATION_PLAN.md` M3 |

Labels: **Fact**, **Problem**, **Risk**, **Assumption (validate)**, **Recommendation** · P0–P3.

---

## 1. Current page inventory (v1)

**Fact.** There are 18 authenticated UI routes, 4 public or patient-facing UI routes, 3 auth routes and 1 onboarding route. API routes are out of IA scope; Workstream C covers them.

| # | Route | File | Rendering | Roles that reach it (nav) | Purpose | v2 disposition |
|---|---|---|---|---|---|---|
| 1 | `/` | `app/(dashboard)/page.tsx` | Server | owner, admin, receptionist, nurse (doctor → `/cabin`, `:42-44`) | Front-desk overview: 4 counters + 8 visits | **Replace** with `/today` |
| 2 | `/queue` | `app/(dashboard)/queue/page.tsx` | Server → client view | all except doctor in nav | Live queue, walk-in, triage, checkout | **Merge** into `/today` |
| 3 | `/cabin` | `app/(dashboard)/cabin/page.tsx` | Server → client | doctor, owner/admin (receptionist/nurse redirected to `/queue`, `:27-29`) | Doctor's queue | **Merge** into `/today` (doctor mode) |
| 4 | `/calendar` | `app/(dashboard)/calendar/page.tsx` | Server → client | all | Multi-doctor day grid, booking, waitlist, blocks | **Rename** `/schedule` |
| 5 | `/visits` | `app/(dashboard)/visits/page.tsx` | Server → client | all | Visits register (filters) | **Move** to `/records/visits` (secondary) |
| 6 | `/consultation/[id]` | `app/(dashboard)/consultation/[id]/page.tsx` | Server → client | doctor (and anyone with the link) | Consultation workspace | **Move** to `/visits/[id]/consult` |
| 7 | `/patients` | `app/(dashboard)/patients/page.tsx` | Server (all rows) → client | all | Patient directory | **Keep**, paginate |
| 8 | `/patients/new` | `app/(dashboard)/patients/new/page.tsx` | Client page | all (create fails for receptionist; see UX_AUDIT F-01) | Registration | **Replace** with QuickRegister sheet; keep the route as a full-page fallback |
| 9 | `/patients/[id]` | `app/(dashboard)/patients/[id]/page.tsx` + `consent-section.tsx` | Server → client tabs | all | Profile (tabs in state) | **Keep**, with tab sub-routes |
| 10 | `/referrals` | `app/(dashboard)/referrals/page.tsx` | Server → client | all | Referrals register | **Move** under `/records/referrals` + patient profile |
| 11 | `/billing/reports` | `app/(dashboard)/billing/reports/page.tsx` | Server → client | owner/admin | Collection reports | **Rename** `/reports/collections`; front desk gets `/collections` |
| 12 | `/billing/register` | `app/(dashboard)/billing/register/page.tsx` (5 lines) | Server | (not in nav) | Redirect to `/billing/reports` | **Remove** (keep as redirect) |
| 13 | `/settings/billing` | `app/(dashboard)/settings/billing/page.tsx` | Server | owner/admin (via Billing & Reports active state) | Subscription (₹1,000/month) | **Move** `/settings/plan` |
| 14 | `/settings/clinic` | `app/(dashboard)/settings/clinic/page.tsx` | Server | owner/admin | Clinic profile, statutory fields | **Keep** |
| 15 | `/settings/developer` | `app/(dashboard)/settings/developer/page.tsx` | Server → client | owner/admin | API keys, webhooks | **Rename** `/settings/integrations` |
| 16 | `/staff` | `app/(dashboard)/staff/page.tsx` | Server | owner/admin | Team and invites | **Move** `/settings/team` |
| 17 | `/profile` | `app/(dashboard)/profile/page.tsx` | Server | all (user menu) | Own profile + doctor availability | **Keep** `/profile`; doctor schedules also editable at `/settings/schedules` |
| 18 | `/clinic/new` | `app/(onboarding)/clinic/new/page.tsx` | Client | new users | Create clinic | **Keep** (onboarding) |
| 19 | `/login`, `/verify`, `/join` | `app/(auth)/*` | Client | public | OTP / invite | **Keep**, restyle |
| 20 | `/r/[token]` | `app/r/[token]/page.tsx` | Server | patient (public token) | Shared report or document viewer | **Keep**, patient-facing theme |
| 21 | `/reschedule/[token]` | `app/reschedule/[token]/page.tsx` | Server/client | patient | Self-reschedule | **Keep**, mobile-first restyle |
| 22 | `/reports/view` | `app/reports/view/page.tsx` | Server | patient or staff via token | Report viewer | **Assumption (validate):** overlaps `/r/[token]`. Consolidate if confirmed. |

**Problems**

- **Problem (P1).** Three overlapping operational views: `/`, `/queue` and `/cabin`. A fourth, `/visits`, overlaps them for history. Users must learn which one to use. The PRD's "same view" requirement for walk-ins and appointments (§4.2) is met only by `/queue`.
- **Problem (P2).** Tabs on the patient profile and query-only filters on other pages are not addressable. Deep links from WhatsApp, notifications or support cannot target "Ramesh's prescriptions".
- **Problem (P2).** Settings are scattered across four top-level paths (`/staff`, `/settings/*`, `/billing/*`, `/profile`).
- **Problem (P2).** `/consultation/[id]` takes a **visit** id, but the URL does not say so.
- **Fact.** `components/dashboard/nav.tsx` is unused (0 importers). Delete it in v2 cleanup.

---

## 2. Current navigation tree (v1)

```
Sidebar (components/layout/app-sidebar.tsx)
├── OPERATIONS
│   ├── [doctor]          Doctor's Cabin · Visits · My Calendar · Patients · Referrals
│   ├── [owner/admin]     Doctor's Cabin · Dashboard · Live Queue · Visits · Calendar · Patients · Referrals   (7 items)
│   └── [receptionist,    Dashboard · Live Queue · Visits · Calendar · Patients · Referrals                   (6 items)
│        nurse]
└── MANAGEMENT [owner/admin]
    └── Staff & Team · Clinic Profile · Billing & Reports · Developer Settings

Header: hamburger/collapse · clinic name + role chip · search ("/" or ⌘/) · AI Copilot (⌘K) · bell · user menu
User menu (components/layout/user-dropdown.tsx): profile, sign out
```

**Problem (P2).** An owner who is also the practising doctor sees 11 nav items. Front desk sees 6 items, of which 3 show the same visits.

---

## 3. Proposed IA (v2)

### 3.1 Principles

1. **Home is the day, not a dashboard.** Every operational role lands on `/today`, which adapts to the role.
2. **Four primary destinations at most per role.** These fit a phone bottom bar. Everything else lives under *More* or Settings.
3. **Patient-centric objects have stable URLs.** Patient → visit → consult/bill. Tabs are routes.
4. **Create from anywhere.** New patient, Walk-in, Book and Collect are commands (the "+" button, ⌘K and keyboard shortcuts), not pages.
5. **Admin is separated from operations.** Settings never compete with daily work in the primary nav.

### 3.2 Role-based navigation

| Destination | Receptionist | Nurse | Doctor | Admin | Owner (practising) |
|---|---|---|---|---|---|
| **Today** `/today` | ● front-desk board | ● triage mode (vitals pending first) | ● "My queue" mode | ● front-desk board | ● toggle front-desk / my queue |
| **Schedule** `/schedule` | ● | ○ (view) | ● (own default) | ● | ● |
| **Patients** `/patients` | ● | ● | ● | ● | ● |
| **Collections** `/collections` | ● (own shift / today) | – | ○ (solo mode) | ● | ● |
| **Reports** `/reports` | – | – | ○ own stats (P3) | ● | ● |
| **Records** `/records/visits`, `/records/referrals` | ○ under More | ○ | ● under More | ● | ● |
| **Settings** `/settings/*` | – | – | ○ own profile only | ● | ● |

● primary nav · ○ secondary (More menu or user menu) · – hidden

**Assumption (validate).** Receptionists get Collections. Today, `billing:view` is owner/admin-only, but receptionists already record payments through `recordPayment` (guarded by `appointments:edit`, `features/billing/actions.ts:200`). A shift-scoped collections view needs a new, narrower permission (`collections:view_own`). Workstream D decides.

### 3.3 Proposed navigation tree

> Update (2026-11-10, PO decisions): The IA gains these surfaces (V2_MASTER_ROADMAP §5, §10.2):
> - **Onboarding and auth:** `/signup` → email code → clinic creation → `/onboarding/billing` ("Start trial": UPI or card AutoPay mandate); `/login` (password); `/forgot-password` (email code); `/join?token` (invite → set password).
> - **Subscription (owner/admin):** `/settings/billing` (plan "₹1,499 + GST", an "AI features: Coming soon" row with no purchase path (PO-21 round 2; no AI add-on in v2.0), next debit (₹1,768.82), payment method, SaaS invoices, cancel or resume, data export, re-purchase). When the clinic is locked, owner/admin go to `/billing/locked` and other roles to `/billing/locked/staff`. Trial, past-due and cancelling banners appear in the shell.
> - **Platform admin:** a separate `(platform)` route group at `/platform/**` (tenant list and detail, trial extension, comp, overrides, reconcile, lifecycle and purge queue). Platform admins only, at aal2, with no clinic navigation and no clinical data. It is never shown in clinic navigation.
> - **Install and app:** "Install app" (Android prompt or iOS instruction sheet) and "Check for updates" under More/Profile; a public `/offline` page; owner security settings (TOTP, sign out everywhere) under Settings → Security.
> - **AI labelling:** LLM features carry the "AI Assist" label. *Round 2 (PO-21):* in v2.0 the scribe appears only during the trial, with a "Preview" chip and note; when not entitled it is **not rendered** (no "Available with AI Assist" lock or upsell). Deterministic helpers are "Smart Assist" or unlabelled (AI_STRATEGY.md §5.3).

```
Primary (desktop sidebar / tablet rail / phone bottom bar)
├── Today            /today
├── Schedule         /schedule
├── Patients         /patients
├── Collections      /collections            (front desk, admin, owner)
└── (+) New ▾        command sheet: Walk-in (W) · Book (B) · New patient (N) · Collect (C)

Secondary (sidebar lower group on desktop; "More" sheet on phone)
├── Records
│   ├── Visits       /records/visits
│   └── Referrals    /records/referrals
├── Reports          /reports  → /reports/collections, /reports/visits, /reports/doctors   (admin/owner)
└── Settings         /settings (admin/owner; others see Profile only)
    ├── Clinic           /settings/clinic          (profile, letterhead, statutory fields, fees)
    ├── Team             /settings/team            (staff, invites, roles)
    ├── Schedules        /settings/schedules       (all doctors' hours, breaks, leave, slot length)
    ├── Plan & billing   /settings/plan            (subscription)
    ├── Notifications    /settings/notifications   (WhatsApp/SMS templates & toggles)  — P2
    └── Integrations     /settings/integrations    (API keys, webhooks)

Global (top bar)
├── Command palette  ⌘K / Ctrl+K / top search field  (patients, today's queue, actions, AI)
├── Notifications    bell → sheet
└── User menu        Profile (/profile), switch clinic (future, PRD §4.1), Help, Sign out
```

### 3.4 Proposed URL structure

| Object or view | URL | Notes |
|---|---|---|
| Today board | `/today?doctor=<id>&lane=waiting&q=` | Date is always today. Past days live in Records. |
| Schedule | `/schedule?date=2026-11-12&view=day\|week\|agenda&doctor=<id>` | `agenda` is the phone default |
| Book (sheet over current page) | `?book=1&patient=<id>&doctor=<id>&date=…` | Intercepting route or search-param sheet, so it is deep-linkable and survives refresh |
| Patients directory | `/patients?q=&page=2&sort=last_visit` | Server-paginated |
| Patient profile | `/patients/[patientId]` → `/timeline` (default), `/prescriptions`, `/documents`, `/profile`, `/consent` | Nested layout keeps the identity header mounted |
| Visit | `/visits/[visitId]` | Read-only summary (any role with access) |
| Consultation | `/visits/[visitId]/consult` | Doctor workspace. Replaces `/consultation/[id]`. |
| Collect payment | `/visits/[visitId]/bill` (sheet over Today) | Deep link from the "To bill" lane |
| Collections | `/collections?date=…&mode=cash\|upi\|card` | |
| Records | `/records/visits?from=&to=&doctor=&status=&page=` · `/records/referrals?…` | |
| Reports | `/reports/collections?from=&to=` · `/reports/visits` · `/reports/doctors` | |
| Settings | `/settings/{clinic,team,schedules,plan,notifications,integrations}` | |
| Profile | `/profile` | |
| Public | `/r/[token]`, `/reschedule/[token]` (unchanged) | |

**Recommendation (P1).** Keep v1 URLs working through permanent redirects in `next.config` `redirects()`. Do not rely on middleware: redirects are cheaper and easier to test.

| v1 | v2 |
|---|---|
| `/` | `/today` (role-aware) |
| `/queue` | `/today` |
| `/cabin` | `/today?mode=doctor` |
| `/calendar` | `/schedule` |
| `/consultation/:id` | `/visits/:id/consult` |
| `/visits` | `/records/visits` |
| `/referrals` | `/records/referrals` |
| `/billing/reports` | `/reports/collections` |
| `/settings/billing` | `/settings/plan` |
| `/settings/developer` | `/settings/integrations` |
| `/staff` | `/settings/team` |
| `/patients/new` | `/patients?new=1` (opens the sheet) |

**Risk.** WhatsApp messages already sent may contain v1 links. Today these are the patient-facing `/r/` and `/reschedule/` links, which stay unchanged. Keep the redirects permanently.

### 3.5 Route-group layout (App Router)

```
app/
  (auth)/login, verify, join
  (onboarding)/clinic/new
  (app)/layout.tsx                 ← shell: resolves membership, role → nav model
    today/page.tsx  loading.tsx  error.tsx
    schedule/page.tsx  loading.tsx
    patients/page.tsx  loading.tsx
    patients/[patientId]/layout.tsx  (identity header)
      page.tsx → redirect timeline, timeline/, prescriptions/, documents/, profile/, consent/
    visits/[visitId]/page.tsx
    visits/[visitId]/consult/page.tsx  loading.tsx  error.tsx
    visits/[visitId]/bill/page.tsx      (also rendered as an intercepted sheet from /today)
    collections/page.tsx
    records/visits/page.tsx  records/referrals/page.tsx
    reports/…  (role-gated layout)
    settings/layout.tsx (role-gated) → clinic/, team/, schedules/, plan/, notifications/, integrations/
    profile/page.tsx
    not-found.tsx  error.tsx
  (public)/r/[token], reschedule/[token]
```

**Recommendation.** Enforce role gating in the server `layout.tsx` (redirect) *and* in every server action. The nav model is derived from one `navForRole(role, permissions)` function, so UI and RBAC cannot drift (UX_AUDIT F-01).

### 3.6 Today: role modes (content model)

| Mode | Default lanes | Row primary action | Secondary |
|---|---|---|---|
| Front desk | Booked · Waiting · With doctor · To bill · Done | Check in / Collect | Vitals, Reschedule, No-show, Cancel, Move doctor |
| Nurse (triage) | Waiting (vitals pending first) · With doctor | Record vitals | – |
| Doctor | Waiting (mine) · With me · Done (mine), with "Next patient" pinned | Call / Open consult | Mark no-show (P2) |
| Owner (practising) | Toggle front desk ↔ doctor | per mode | per mode |

### 3.7 Command palette content model

| Group | Items | Visible to |
|---|---|---|
| Patients | ranked search results with inline actions (Add to queue, Book, Open, Collect) | all with `patients:view` |
| Today | queue matches by token, name or phone | all |
| Actions | New patient · Walk-in · Book · Collect · Block time · Invite staff | role-filtered |
| Navigate | every destination in §3.3 | role-filtered |
| Assist | "Ask Copilot: …" (opens the AI panel with the query) | roles allowed by `tests/security/ai-rbac.spec.ts` rules |

---

## 4. Object model surfaced in the UI

```
Clinic (tenant)
 ├── Staff (role: owner | admin | doctor | receptionist | nurse)
 │     └── Doctor schedule (shifts, breaks, leave, slot length)
 └── Patient (ID, demographics, allergies, chronic conditions, consent)
       └── Visit (origin: appointment | walk_in; status: booked → confirmed → waiting → in_consultation → completed | cancelled | no_show)
             ├── Queue token (per day, per clinic)
             ├── Vitals
             ├── Consultation note (complaints, exam/specialty, diagnoses, investigations, advice, follow-up)
             ├── Prescription (items)
             ├── Lab orders / documents
             ├── Referral
             └── Invoice (items, discount) → Payments (cash | upi | card)
```

**Assumption (validate).** "To bill" is derived from `completed` with an unpaid invoice balance, rather than a new persisted status. Workstream C should confirm which is cheaper and more correct.

---

## 5. Labels and terminology

| v1 label | v2 label | Why |
|---|---|---|
| Doctor's Cabin / Live Queue / Dashboard | **Today** | One home |
| Calendar / My Calendar | **Schedule** | Matches clinic language ("schedule" or "appointments") |
| Checkout | **Collect payment** / **Bill** | "Checkout" is e-commerce language |
| Start Consultation | **Call in** (front desk), **Start consult** (doctor) | Role-specific |
| Complete & Sign Rx | **Finish visit** | One verb. Signing is part of finishing. |
| Developer Settings | **Integrations** | Less intimidating for owners |
| Staff & Team | **Team** | |
| UHID / National Health ID / ID | **Patient ID** (+ ABHA when present) | Consistent |
| Triage | **Vitals** | Plain language for tier-2/3 staff |

**Recommendation (P2).** Keep all user-facing strings in one `messages/en.ts` dictionary from the start of v2. This is cheap now and enables Hindi later (PRD §10 lists it as out of scope "unless specified"). The TailAdmin template already uses `next-intl`. That pattern is available but should not be adopted until i18n is approved (P3).
