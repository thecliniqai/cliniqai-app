---
phase: "06"
slug: "api-launch-readiness"
status: approved
reviewed_at: "2026-11-09T14:31:00Z"
shadcn_initialized: false
preset: none
created: "2026-11-09"
---

# Phase 06 — UI Design Contract: API & Launch Readiness

> Visual and interaction contract for frontend components in Phase 06: Developer Settings (API Keys & Webhooks), Clinic Statutory Registrations, and DPDP Act Patient Rights (Export, Consent & Erasure).
> Authoritative guide for layout, tokens, typography, component interactions, and state handling.
> Single source of visual truth: `DESIGN.md` (Light theme only, Inter font, `#1769E0` brand primary, Radix UI primitives, TailAdmin design tokens).

---

## Design System

| Property | Value | Notes |
|----------|-------|-------|
| Tool | none | Native Tailwind CSS v4 + React 19 + Lucide Icons (no shadcn) |
| Preset | not applicable | Custom design tokens defined in `DESIGN.md` & `app/globals.css` |
| Component library | custom | Accessible primitives in `components/ui/` |
| Icon library | lucide-react | Standard icons: `Key`, `Webhook`, `Copy`, `Check`, `Trash2`, `AlertTriangle`, `Download`, `FileText`, `ShieldAlert`, `RefreshCw`, `ExternalLink`, `Lock`, `Plus`, `X`, `ChevronRight` |
| Font | Inter (`next/font/google`) | 400 (Regular), 600 (Semi-Bold) |

---

## Component Inventory

> What the project's design system actually provides. Enumerate this from the installed package — never from recall.

Enumerated by `ls components/ui` — 12 components — clinicos@0.1.0 — 2026-11-09.

| Component | Import Path | When to Reach for It |
|-----------|-------------|----------------------|
| `Alert` | `@/components/ui/alert` | In-app notification alerts, permission denial warnings, single-reveal key security notices |
| `Badge` | `@/components/ui/badge` | Status pills (`Active`, `Revoked`, `200 OK`, `Failed`, `Pending`), event category tags |
| `Button` | `@/components/ui/button` | Primary actions (`Create New API Key`, `Save Endpoint Subscription`), secondary dismiss, destructive (`Revoke API Key`) |
| `Card` | `@/components/ui/card` | Structural panels (`CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`) |
| `Dropdown` | `@/components/ui/dropdown` | Quick action menus, DPDP export format selection dropdown |
| `EmptyState` | `@/components/ui/empty-state` | Zero-state views for API keys table, webhook subscriptions list, and delivery logs |
| `Field` | `@/components/ui/field` | Form label, help text, and validation error container for inputs |
| `Input` | `@/components/ui/input` | Key name input, endpoint URL input, statutory registration inputs |
| `Modal` | `@/components/ui/modal` | Single-reveal key modal, key revocation confirmation, patient erasure modal |
| `PhoneInput` | `@/components/ui/phone-input` | Unified 10-digit Indian mobile input with inset `🇮🇳 +91` badge |
| `Select` | `@/components/ui/select` | Event filter select, status filter select |
| `Table` | `@/components/ui/table` | Master tables (`TableContainer`, `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`) |

### Phase 06 Feature Components (To Construct)

| Component | Target Import Path | Role & Usage |
|-----------|--------------------|--------------|
| `DeveloperSettingsView` | `@/components/settings/developer/developer-settings-view.tsx` | Main developer workspace containing API Keys and Webhooks cards |
| `ApiKeyTable` | `@/components/settings/developer/api-key-table.tsx` | Active API keys table with prefix, role, dates, and revoke trigger |
| `CreateApiKeyModal` | `@/components/settings/developer/create-api-key-modal.tsx` | Input modal prompting for key label/name |
| `SingleRevealKeyModal` | `@/components/settings/developer/single-reveal-key-modal.tsx` | Security modal revealing raw `clq_live_...` key once with 1-click clipboard copy |
| `RevokeKeyModal` | `@/components/settings/developer/revoke-key-modal.tsx` | Destructive confirmation dialog before key invalidation |
| `WebhookSubscriptionList` | `@/components/settings/developer/webhook-subscription-list.tsx` | Subscriptions table showing endpoint URL, event pills, signing secret toggle, ping button |
| `CreateWebhookModal` | `@/components/settings/developer/create-webhook-modal.tsx` | Endpoint registration modal with URL input and 6 event checkboxes |
| `WebhookDeliveryLogsDrawer` | `@/components/settings/developer/webhook-delivery-logs-drawer.tsx` | 480px slide-over drawer displaying chronological delivery logs, retry counts, latency |
| `StatutoryFieldsCard` | `@/components/settings/statutory-fields-card.tsx` | Card in Clinic Settings for CEA, SMC, GSTIN, and Drug License numbers |
| `GlobalConsentToggle` | `@/components/patients/global-consent-toggle.tsx` | Single Active vs Withdrawn consent switch on patient profile |
| `DpdpExportActions` | `@/components/patients/dpdp-export-actions.tsx` | Dual-format export actions (JSON archive and Medical Summary PDF) |
| `ErasePatientModal` | `@/components/patients/erase-patient-modal.tsx` | Soft-delete erasure confirmation modal detailing NMC 3-year retention rules |

---

## Spacing Scale

Declared values (strictly multiples of 4, drawn from scale {4, 8, 16, 24, 32, 48, 64}):

| Token | Value | Usage in Phase 06 |
|-------|-------|-------------------|
| xs | 4px | Icon gaps, chip margins, inline badge vertical padding (`gap-1`, `p-1`, `py-1`) |
| sm | 8px | Button padding, compact element spacing, event pill gaps (`gap-2`, `p-2`, `py-2`) |
| md | 16px | Field rhythm, card internal spacing, table cell padding (`p-4`, `space-y-4`) |
| lg | 24px | Section padding, modal padding, drawer interior padding (`p-6`, `space-y-6`) |
| xl | 32px | Major section breaks between API Keys and Webhooks cards (`space-y-8`) |
| 2xl | 48px | Empty state vertical padding, zero-state breathing room (`py-12`) |
| 3xl | 64px | Page boundary spacing (`py-16`) |

Exceptions: none (44px min touch target on mobile buttons is handled via `min-h-[44px]` per `DESIGN.md` & `AGENTS.md` §26).

---

## Typography

Strictly limited to 4 sizes and 2 weights (Regular 400 and Semi-Bold 600), matching `DESIGN.md` §6:

| Role | Size | Weight | Line Height | Usage in Phase 06 |
|------|------|--------|-------------|-------------------|
| Body | 14px | 400 | 1.5 | Descriptions, table cell content, explanatory legal retention notices |
| Label | 12px | 600 | 1.5 | Table headers, status badges, HTTP status pills (`200 OK`), input field labels, timestamps, key prefixes (`clq_live_••••`) |
| Heading | 20px | 600 | 1.2 | Card titles (`REST API Keys`, `Webhook Subscriptions`), modal titles, drawer headers |
| Display | 28px | 600 | 1.2 | Page title (`Developer Settings`, `Clinic Profile & Settings`) |

Tabular figures (`font-feature-settings: "tnum"` / `tabular-nums`) are required for:
- API key prefixes (`clq_live_••••` at 12px / 600)
- Webhook signing secrets (`whsec_••••` at 12px / 600)
- Latency and durations (`142ms` at 12px / 600)
- HTTP status codes (`200`, `500` at 12px / 600)
- Retry counts (`1/5`, `3/5` at 12px / 600)
- Dates and timestamps (`2026-11-09 14:30` at 14px / 400)

---

## Color

Conforms strictly to `DESIGN.md` §5 (60% Dominant / 30% Secondary / 10% Accent, Light Theme Only):

| Role | Value | Usage in Phase 06 |
|------|-------|-------------------|
| Dominant (60%) | `#FFFFFF` / `#F7F6F3` | Application canvas (`#F7F6F3`), card backgrounds (`#FFFFFF`), modal surfaces (`#FFFFFF`) |
| Secondary (30%) | `#FFFFFF` / `#F1F2F4` / `#E4E5E7` | Table headers (`#F1F2F4`), card borders (`#E4E5E7`), secondary text (`#52565B`), neutral pills (`#F1F2F4`) |
| Accent (10%) | `#1769E0` | Primary action buttons, active navigation indicator, focus rings, selected event pills |
| Destructive | `#B42318` | Key revocation buttons, patient erasure modal actions, HTTP 5xx error badges |

### Accent Reserved For (Explicit List — Never "All Interactive Elements"):
1. Primary submit actions: `[Create New API Key]`, `[Save Endpoint Subscription]`, `[Save Statutory Details]`, `[Export Medical Summary PDF]`.
2. Active navigation indicators: Sidebar `/settings/developer` nav item highlight and top settings sub-navigation pill.
3. Event checkbox checked state: Active multi-select checkboxes for webhook event triggers.
4. Focused form inputs: `focus:border-[#1769E0] focus:ring-1 focus:ring-[#1769E0]`.
5. Key prefix chip: Subtle highlight on `clq_live_` key display prefix badge.

### Semantic Color Matrix:
- **Brand Primary:** `#1769E0` (Hover: `#0F5AB8`, Soft: `#EAF2FF`, Subtle: `#DCEBFF`)
- **Neutral Surface:** Background `#F1F2F4`, Text `#5A5A5A`, Border `#D9DCE0`
- **Info / Blue Semantic:** Background `#EAF2FF`, Text `#1769E0`, Border `#BFD8FF` (used for `Clinic Admin` role badge and API key prefix pill)
- **Success:** Background `#EAF7F0`, Text `#18794E`, Border `#BDE5CF` (used for `Active Consent` badge, `200 OK` delivery status, and clipboard copied check)
- **Warning:** Background `#FFF5E5`, Text `#9A5B00`, Border `#F3D39A` (used for single-reveal key security callout, `Pending Retry` delivery badge, and `Withdrawn Consent` pill)
- **Error / Destructive:** Background `#FDECEA`, Text `#B42318`, Border `#F2B8B5` (used for `Revoked` key badge, `500 Server Error` delivery badge, and destructive actions `[Revoke API Key]`, `[Confirm Patient Erasure]`)

---

## Copywriting Contract

| Element | Copy | Notes |
|---------|------|-------|
| Primary CTA (New Key) | `Create New API Key` | Specific verb + noun; opens creation modal |
| Primary CTA (Confirm Key) | `Generate API Key` | Triggers key hashing and single-reveal state |
| Secondary CTA (Dismiss Key) | `Done, I Have Saved My Key` | Explicit acknowledgement of one-time key storage |
| Copy Key CTA | `Copy Secret Key` | Copies raw key to clipboard; changes to `✓ Copied to Clipboard` for 2 seconds |
| Table Action (Revoke Key) | `Revoke Key` | Inline button opening revocation confirmation dialog |
| Secondary CTA (Dismiss Revoke) | `Keep API Key` | Cancels revocation dialog without revoking key |
| Destructive CTA (Revoke Key) | `Revoke API Key` | Destructive red button invalidating key immediately |
| Primary CTA (New Webhook) | `Add Webhook Endpoint` | Opens endpoint registration modal |
| Secondary CTA (Dismiss Webhook) | `Discard Endpoint` | Cancels webhook modal without saving |
| Primary CTA (Save Webhook) | `Save Endpoint Subscription` | Submits URL and selected events |
| Table Action (Ping) | `Send Test Ping` | Dispatches synthetic ping event to endpoint |
| Table Action (Logs) | `View Delivery Logs` | Opens slide-over drawer with delivery history |
| Table Action (Delete Webhook) | `Delete Webhook` | Inline button opening deletion confirmation dialog |
| Secondary CTA (Dismiss Delete Webhook) | `Keep Webhook Subscription` | Cancels webhook deletion dialog |
| Destructive CTA (Delete Webhook) | `Delete Webhook Subscription` | Destructive red button removing subscription |
| Drawer Dismiss CTA | `Close Delivery Logs` | Closes delivery logs slide-over drawer |
| Primary CTA (Statutory) | `Save Statutory Details` | Persists CEA, SMC, GSTIN, and Drug License fields |
| Primary CTA (Consent Toggle) | `Update Consent Status` | Toggles Active vs Withdrawn with audit trail |
| Primary CTA (Export PDF) | `Download Medical Summary (PDF)` | Streams clinic-branded PDF |
| Primary CTA (Export JSON) | `Download Machine Archive (JSON)` | Downloads raw JSON archive |
| Secondary CTA (Dismiss Erasure) | `Keep Patient Record` | Cancels erasure modal without modifying patient |
| Destructive CTA (Erase Patient) | `Confirm Patient Erasure` | Executes soft-delete with NMC retention lock |
| Empty state heading (API Keys) | `No API Keys Created` | Calm, helpful zero-state |
| Empty state body (API Keys) | `Generate a tenant-scoped API key to integrate external clients, EHRs, or the AI voice agent with ClinicQ.` | Clear explanation + next step |
| Empty state heading (Webhooks) | `No Webhook Subscriptions` | Clean zero-state |
| Empty state body (Webhooks) | `Subscribe an HTTPS endpoint to receive real-time notifications for appointment bookings, completed visits, and lab reports.` | Clear explanation + next step |
| Empty state heading (Delivery Logs) | `No Deliveries Recorded` | Clean zero-state for new webhook |
| Empty state body (Delivery Logs) | `Deliveries for this subscription will appear here with HTTP response codes, latency, and retry attempts.` | Informational explanation |
| Error state (Key Generation) | `Unable to generate API key. Verify network connection and try again.` | Problem + immediate action |
| Error state (Webhook URL) | `Invalid endpoint URL. Destinations must use the secure HTTPS protocol.` | Problem + corrective requirement |
| Error state (Test Ping Failure) | `Webhook test ping failed. The receiver returned HTTP 500 or timed out after 5 seconds.` | Problem + diagnostic info |
| Error state (Statutory Save) | `Failed to update statutory details. Check required fields and retry.` | Problem + corrective requirement |
| Destructive confirmation (Revoke Key) | `Revoke API Key: Are you sure you want to revoke key "{name}"? Any external services using this key will immediately lose access.` | Explicit consequence stated |
| Destructive confirmation (Delete Webhook) | `Delete Webhook: Are you sure you want to delete endpoint "{url}"? Pending retries will be dropped.` | Explicit consequence stated |
| Destructive confirmation (Erase Patient) | `Erase Patient Record: Are you sure you want to process this DPDP erasure request? The patient will be permanently removed from active searches, queues, and booking. Clinical history will be archived under restricted compliance retention to satisfy NMC mandatory 3-year regulations.` | Explicit legal & clinical consequence |
| Single-Reveal Security Notice | `Save this secret key now: For security reasons, this raw API key will never be displayed again. If you lose this key, you will need to generate a new one.` | Amber callout in single-reveal modal |
| NMC Statutory Retention Notice | `Statutory Medical Retention Notice: Under Regulation 1.3.1 of the NMC Regulations, clinical records must be retained for 3 years. Active workflows are suppressed, while clinical encounters remain secured for legal compliance.` | Persistent disclaimer in erasure modal |

---

## Surface & Component Specifications

### 1. Developer Settings Page (`/settings/developer`)

#### 1.1 Route, Visual Hierarchy & Access Control
- Route: `/settings/developer`
- Access: Restricted strictly to `owner` and `admin` roles. Non-admin staff attempting to navigate here receive a standard access-denied card.
- Navigation placement: Mounted in `components/layout/app-sidebar.tsx` under the `Management` group as `Developer Settings` with the `Key` icon.
- Top breadcrumb & header:
  - Title: `Developer Settings` (`28px / 600`)
  - Subtitle: `Manage tenant-scoped API keys, outgoing webhook subscriptions, and external developer integrations.`
- **Primary Visual Anchor:** The `REST API Keys` card positioned at the top of the page serves as the focal point, anchored by the dominant brand blue `[+ Create New API Key]` primary CTA button (`#1769E0`). The `Webhook Subscriptions` card visually recedes below it with secondary rhythm.

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Developer Settings                                                                     │
│ Manage tenant-scoped API keys, outgoing webhook subscriptions, and external integrations│
├────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ 🔑 REST API Keys (Primary Visual Anchor)                   [ + Create New API Key ]│ │
│ │ Authenticate external clients and backend integrations using Bearer tokens.        │ │
│ │────────────────────────────────────────────────────────────────────────────────────│ │
│ │ Name            Prefix              Scope         Created       Last Used  Actions │ │
│ │ Voice Agent     clq_live_8f9a2b...  Clinic Admin  09 Nov 2026   10m ago    [Revoke]│ │
│ │ Partner EHR     clq_live_3c4d1e...  Clinic Admin  01 Nov 2026   Never      [Revoke]│ │
│ └────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                        │
│ ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ 🪝 Webhook Subscriptions                                 [ + Add Webhook Endpoint ]│ │
│ │ Receive real-time signed HTTP POST payloads when clinical lifecycle events occur.   │ │
│ │────────────────────────────────────────────────────────────────────────────────────│ │
│ │ Endpoint URL                    Subscribed Events     Status    Secret     Actions │ │
│ │ https://api.partner.com/events  [appts] [visits] [rx] ● Active  whsec_•••  [Ping]  │ │
│ │                                                                            [Logs]  │ │
│ │                                                                            [Delete]│ │
│ └────────────────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

#### 1.2 API Keys Section (`components/settings/developer/api-key-table.tsx`)
- Card Container: Standard flat card (`border border-[#E4E5E7] bg-white rounded-xl shadow-theme-xs`).
- Card Header: Title `REST API Keys` (`20px / 600`), Subtitle `Authenticate external clients and backend integrations using Bearer tokens` (`14px / 400`), Action button `[+ Create New API Key]`.
- Table Columns:
  1. `Name` (Text, 14px / 600, e.g. "AI Voice Agent Integration")
  2. `Key Prefix` (Mono font, 12px / 600, badge styling `bg-gray-100 px-2 py-1 rounded text-gray-700`, e.g. `clq_live_8f9a2b1c...`)
  3. `Scope` (Badge `Clinic Admin` in `bg-[#EAF2FF] text-[#1769E0] border border-[#1769E0]/20` at 12px / 600)
  4. `Created` (Text, 14px / 400, tabular date e.g. "09 Nov 2026")
  5. `Last Used` (Text, 14px / 400, tabular format e.g. "12 mins ago" or "Never")
  6. `Actions` (Ghost button `[Revoke Key]` with `Trash2` icon, `text-rose-600 hover:bg-rose-50 rounded-lg px-4 py-2`, with `aria-label="Revoke API key"`)
- Empty State: When 0 keys exist, renders `EmptyState` component with `Key` icon, heading `No API Keys Created`, body text, and `[Create New API Key]` action button.

#### 1.3 Key Creation & Single-Reveal Modal (`components/settings/developer/single-reveal-key-modal.tsx`)
1. **Step 1: Input Dialog**
   - Title: `Create API Key` (`20px / 600`)
   - Description: `Enter a descriptive label to identify which application or service will use this key.` (`14px / 400`)
   - Field: `Key Name` (Input, required, placeholder e.g. "External AI Voice Receptionist")
   - Actions: `[Discard Key]` (secondary button) and `[Generate API Key]` (primary `#1769E0`).
2. **Step 2: Single-Reveal State (After Generation)**
   - Header: Title `API Key Generated Successfully` (`20px / 600`) with a green check badge.
   - Amber Warning Banner (`bg-[#FFF5E5] border border-[#F3D39A] rounded-xl p-4 flex items-start gap-2`):
     - Icon: `AlertTriangle` in `#9A5B00` (16px).
     - Copy: `Save this secret key now: For security reasons, this raw API key will never be displayed again. If you lose this key, you will need to generate a new one.` (`14px / 400`)
   - Secret Key Display Box:
     - Full key string: `clq_live_7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b` in monospace font (`font-mono text-xs bg-gray-50 border border-gray-300 rounded-xl p-4 select-all overflow-x-auto break-all` at 12px / 600).
     - Action: Primary `[Copy Secret Key]` button with `Copy` icon and `aria-label="Copy raw API key to clipboard"`. Upon clicking, transitions to `[✓ Copied to Clipboard]` with emerald styling for 2 seconds.
   - Modal Footer: Single primary button `[Done, I Have Saved My Key]`, closing the modal and refreshing the table.

#### 1.4 Key Revocation Modal (`components/settings/developer/revoke-key-modal.tsx`)
- Triggered by clicking `[Revoke Key]` on an active key row.
- Dialog width: `max-w-md` (Level 2 modal, `p-6`).
- Icon: Red alert banner with `ShieldAlert` (16px).
- Title: `Revoke API Key` (`20px / 600`)
- Body: `Are you sure you want to revoke key "{name}" ({prefix})? Any external services, AI voice agents, or partner EHR integrations using this key will immediately lose access. This action cannot be undone.` (`14px / 400`)
- Actions:
  - `[Keep API Key]` (secondary button, `px-4 py-2`)
  - `[Revoke API Key]` (destructive button, `#B42318` background, white text, `px-4 py-2`).

---

### 2. Webhook Subscriptions Section

#### 2.1 Subscriptions List (`components/settings/developer/webhook-subscription-list.tsx`)
- Card Header: Title `Webhook Subscriptions` (`20px / 600`), Subtitle `Receive real-time signed HTTP POST payloads when clinical lifecycle events occur` (`14px / 400`), Action button `[+ Add Webhook Endpoint]`.
- List Item / Table Row Layout:
  - Column 1: `Endpoint URL` — Semi-Bold text (`14px / 600`) with HTTPS lock icon (`https://api.partner.com/webhooks/clinicq`), truncated with tooltip if > 40 chars.
  - Column 2: `Subscribed Events` — Stack of compact pills at 12px / 600:
    - `appointment.booked`
    - `appointment.cancelled`
    - `appointment.rescheduled`
    - `visit.completed`
    - `lab_result.ready`
    - `prescription.issued`
  - Column 3: `Signing Secret` — Obfuscated display `whsec_••••••••••••` (12px / 600) with a `[Show / Copy]` toggle.
  - Column 4: `Status` — `● Active` (emerald badge at 12px / 600) or `● Inactive` (gray badge).
  - Column 5: `Actions`:
    - `[Send Test Ping]` (Ghost button with `RefreshCw` icon; shows spinner + inline result badge on click).
    - `[View Delivery Logs]` (Outline button with `FileText` icon; opens drawer).
    - `[Delete Webhook]` (Ghost icon button with `Trash2` icon and `aria-label="Delete webhook subscription"`; triggers deletion modal).

#### 2.2 Endpoint Registration Modal (`components/settings/developer/create-webhook-modal.tsx`)
- Modal width: `max-w-lg` (`p-6`)
- Title: `Add Webhook Endpoint` (`20px / 600`)
- Description: `Configure an HTTPS URL to receive automated clinical lifecycle webhook events.` (`14px / 400`)
- Form Fields:
  1. `Endpoint URL` (Input, required, placeholder `https://api.example.com/webhooks`):
     - Real-time client validation requiring valid `https://` prefix. Shows inline error `Must begin with https://` if `http://` or raw IP is entered.
  2. `Description` (Input, optional, placeholder e.g. "Partner Diagnostic Sync")
  3. `Events to Send` (Multi-select checkbox list with `[Select All]` quick-toggle):
     - `appointment.booked` — Fired when a patient appointment is scheduled or confirmed.
     - `appointment.cancelled` — Fired when an appointment is cancelled and the slot is released.
     - `appointment.rescheduled` — Fired when appointment date or time is modified.
     - `visit.completed` — Fired when a doctor completes and signs off a consultation.
     - `lab_result.ready` — Fired when a diagnostic lab result or document is uploaded.
     - `prescription.issued` — Fired when an e-prescription is finalized.
- Actions: `[Discard Endpoint]` (secondary button) and `[Save Endpoint Subscription]` (primary button).

#### 2.3 Webhook Delivery Logs Drawer (`components/settings/developer/webhook-delivery-logs-drawer.tsx`)
- Geometry: 480px slide-over right drawer (desktop), full width (mobile), matching `OperationsCopilotDrawer` structure.
- Header:
  - Title: `Webhook Delivery Logs` (`20px / 600`)
  - Subtitle: `Recent HTTP delivery attempts for {endpoint_url}` (`14px / 400`)
  - Close button `[✕]` (`X` icon with `aria-label="Close delivery logs drawer"`).
- Filter Bar: Quick status filter pills `[All Deliveries]`, `[Success (2xx)]`, `[Failed (4xx/5xx)]`.
- Deliveries Table:
  - Headers: `Event`, `Status`, `Retries`, `Latency`, `Time` (`12px / 600`)
  - Status Pill Styling:
    - `200 OK`: `bg-emerald-50 text-emerald-700 border border-emerald-200`
    - `500 Error` / `404 Not Found`: `bg-rose-50 text-rose-700 border border-rose-200`
    - `Pending Retry`: `bg-amber-50 text-amber-700 border border-amber-200`
  - Latency & Attempts: Tabular figures e.g. `142ms`, `Attempt 1 of 5` (`12px / 600`).
- Expandable Detail Drawer Accordion:
  - Clicking any delivery log row expands inline JSON payload inspection:
    - Request Headers: `X-ClinicQ-Signature: t=1762700000,v1=9f8a...`, `Content-Type: application/json`
    - Request Body Preview: Code block showing event payload `{ id, event, created_at, data: {...} }`
    - Response Headers & Body: HTTP response snippet returned by receiver.

---

### 3. Statutory Registrations Card (`/settings/clinic`)

Mounted directly inside the existing Clinic Settings page (`components/settings/clinic-profile-form.tsx` or as a companion card `components/settings/statutory-fields-card.tsx`).

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 🏥 Statutory Clinic Registrations & Licenses                                           │
│ Official healthcare establishment and regulatory identification numbers (Optional).   │
│ Printed on official clinic letterheads and e-prescription PDFs when populated.        │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Clinical Establishment Act Reg. No.          State Medical Council Reg. No.            │
│ [ e.g. CEA-MH-2022-8491                  ]   [ e.g. KMC/CLINIC/2021/049             ]  │
│                                                                                        │
│ GSTIN (Goods & Services Tax ID)              Drug License Number                       │
│ [ e.g. 27AAPCU5050M1ZV                   ]   [ e.g. DL-20B-184920                   ]  │
│                                                                                        │
│ ℹ️ Optional fields. When provided, these details automatically render on official      │
│    prescriptions, receipts, and clinical referral documents.                           │
│                                                            [ Save Statutory Details ]  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

- Card Title: `Statutory Clinic Registrations & Licenses` (`20px / 600`)
- Card Description: `Official healthcare establishment and regulatory identification numbers (Optional). Printed on official clinic letterheads and e-prescription PDFs when populated.` (`14px / 400`)
- Grid Layout: 2 columns on desktop/tablet (`sm:grid-cols-2 gap-4`), single column on mobile.
- Form Fields:
  1. `Clinical Establishment Act Reg. No.` (`clinical_establishment_reg_no`)
     - Label: `Clinical Establishment Act Reg. No.` (`12px / 600`)
     - Help text: `National / State CEA establishment registration number.` (`12px / 400`)
     - Input: Standard text, uppercase styling, placeholder `e.g. CEA-MH-2022-8491`
  2. `State Medical Council Reg. No.` (`state_medical_council_reg_no`)
     - Label: `State Medical Council Reg. No.` (`12px / 600`)
     - Help text: `Clinic registration number issued by SMC / Directorate of Health Services.` (`12px / 400`)
     - Input: Standard text, uppercase styling, placeholder `e.g. KMC/CLINIC/2021/049`
  3. `GSTIN (GST Identification Number)` (`gstin`)
     - Label: `GSTIN (Optional)` (`12px / 600`)
     - Help text: `15-digit GST identification number for taxable diagnostic/billing supplies.` (`12px / 400`)
     - Input: Standard text, uppercase styling, 15 char max, placeholder `e.g. 27AAPCU5050M1ZV`
  4. `Drug License Number` (`drug_license_no`)
     - Label: `Drug License Number (Optional)` (`12px / 600`)
     - Help text: `Form 20/20B retail pharmacy or in-clinic drug dispensing license.` (`12px / 400`)
     - Input: Standard text, uppercase styling, placeholder `e.g. DL-20B-184920`
- Footer Action: `[Save Statutory Details]` primary button (`#1769E0`), disabled with spinner while saving.

---

### 4. DPDP Act Patient Rights (`/patients/[id]`)

Mounted in Patient Profile (`app/(dashboard)/patients/[id]/`):

#### 4.1 Global Consent Status Switch (`components/patients/global-consent-toggle.tsx`)
- Container: Inset card banner in the patient record overview panel (`p-4`).
- States:
  - **Active Consent:** Emerald status pill `● Active Consent` (`bg-emerald-50 text-emerald-800 border-emerald-200` at 12px / 600), description `Patient has provided explicit consent for medical care, communications, and clinical record processing under the DPDP Act 2023.` (`14px / 400`)
  - **Withdrawn Consent:** Amber status pill `● Withdrawn Consent` (`bg-amber-50 text-amber-800 border-amber-200` at 12px / 600), description `Patient has withdrawn processing consent. Outbound notifications and data sharing are suppressed.` (`14px / 400`)
- Action: Accessible switch toggle. When toggled, prompts with a confirmation alert before committing the append-only `consent_records` row and updating the UI.

#### 4.2 DPDP Data Export Actions (`components/patients/dpdp-export-actions.tsx`)
- Placement: Top action bar of Patient Profile next to `[Edit Patient]`.
- Dropdown Button: `[Export Patient Data ▾]` with `Download` icon.
- Options:
  1. `Download Medical Summary (PDF)`:
     - Generates and streams consolidated A4 PDF containing demographics, vitals, chronic conditions, allergy list, all clinical encounters, and issued prescriptions on official clinic stationery.
  2. `Download Machine Archive (JSON)`:
     - Triggers browser download of `{patient_uhid}_dpdp_export.json` containing structured portable records.

#### 4.3 Right to Erasure Modal (`components/patients/erase-patient-modal.tsx`)
- Triggered by clicking `[Erase Patient Record (DPDP)]` in the patient profile settings/danger zone.
- Modal Dialog: `max-w-md` (`p-6`).
- Header: Red alert badge with `ShieldAlert`, Title `Process Patient Erasure Request` (`20px / 600`).
- Mandatory Regulatory Disclaimer Banner (`bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-900 leading-relaxed`):
  `⚠️ Statutory Medical Retention Notice: Under Regulation 1.3.1 of the National Medical Commission (NMC) Regulations, registered medical practitioners must retain clinical records for a minimum of 3 years. This action will soft-delete the patient, suppressing them from active search, queues, and future appointments, while retaining historical clinical encounters under restricted compliance access.`
- Form Field:
  - `Reason for Erasure Request` (Input/Textarea, required, placeholder e.g. "Formal data erasure request submitted by patient under DPDP Section 12").
- Actions:
  - `[Keep Patient Record]` (secondary button, `px-4 py-2`)
  - `[Confirm Patient Erasure]` (destructive red button, `#B42318`, `px-4 py-2`).

---

## UI Considerations & State Coverage

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| `empty` | API Keys Table | ✅ covered | Shows centered `Key` icon, "No API Keys Created" heading, explanatory body text, and `[Create New API Key]` action button. |
| `empty` | Webhook Subscriptions List | ✅ covered | Shows centered `Webhook` icon, "No Webhook Subscriptions" heading, and `[Add Webhook Endpoint]` button. |
| `empty` | Webhook Delivery Logs Drawer | ✅ covered | Shows centered `FileText` icon, "No Deliveries Recorded" heading, and informational text. |
| `loading` | Key Generation / Save Action | ✅ covered | Buttons switch to spinner state (`animate-spin` SVG) with disabled pointer events. |
| `loading` | Test Ping Action | ✅ covered | Button icon spins with "Pinging..." text; returns inline result badge on completion. |
| `loading` | DPDP PDF / JSON Export | ✅ covered | Button shows progress indicator ("Compiling Medical Summary PDF..."); triggers browser download on completion. |
| `error` | Key Generation Failure | ✅ covered | Renders inline alert: "Unable to generate API key. Verify network connection and try again." |
| `error` | Webhook URL Protocol Mismatch | ✅ covered | Real-time input validation flags non-HTTPS endpoints: "Destinations must use the secure HTTPS protocol." |
| `error` | Test Ping Timeout / 500 Error | ✅ covered | Displays red error badge: "Webhook test ping failed. The receiver returned HTTP 500 or timed out after 5 seconds." |
| `error` | Statutory Form Save Failure | ✅ covered | Banner alert: "Failed to update statutory details. Check required fields and retry." |
| `populated` | Active API Keys Table | ✅ covered | Clean row with key name, monospace prefix badge (`clq_live_...` at 12px / 600), scope badge, creation date, and `[Revoke Key]` button. |
| `populated` | Webhook Subscriptions Table | ✅ covered | Clean row with URL, 6 event badges, hidden secret with copy button, active status, ping and logs buttons. |
| `partial` | Webhook Event Selection | ✅ covered | Checkboxes allow selecting 1 to 6 events with "Select All" quick-toggle. |
| `partial` | Statutory Clinic Fields | ✅ covered | All 4 statutory fields are completely optional; saving with 1, 2, 3, or all 4 fields populated is fully supported. |
| `overflow` | Long Webhook URLs | ✅ covered | Endpoint URLs truncate with CSS ellipsis (`max-w-xs truncate`) and full URL in native hover tooltip. |
| `overflow` | Long Delivery Log History | ✅ covered | Drawer body scrolls vertically with custom scrollbar while header and filter bar remain sticky. |
| `zero-one-many` | API Keys Collection | ✅ covered | 0 keys: empty state; 1 key: single table row; multiple keys: paginated or scrollable table. |
| `long-text` | Erasure Request Reason | ✅ covered | Textarea supports multi-line reasons wrapping cleanly without container breakage. |
| `security-callout` | Single-Reveal Key State | ✅ covered | High-visibility amber warning box with 1-click clipboard copy and confirmation feedback. |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not required |
| third-party | none | not required (all components implemented with custom TailAdmin primitives adhering to `DESIGN.md`) |

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS (Specific verb + noun CTAs, non-generic secondary dismiss actions `[Discard Key]`, `[Keep API Key]`, `[Discard Endpoint]`, `[Keep Patient Record]`, explicit empty states with solution paths, explicit error states, destructive action confirmations, mandatory NMC legal retention notice)
- [x] Dimension 2 Visuals: PASS (Light theme only, solid `#FFFFFF` surfaces, Level 0 borders, Level 2 dialog and drawer elevations, no decorative gradients, explicit primary visual anchor on REST API Keys card and `[+ Create New API Key]` CTA, explicit `aria-label` attributes on icon-only actions)
- [x] Dimension 3 Color: PASS (60% background/surfaces, 30% secondary cards/borders, 10% accent reserved for specific elements, destructive `#B42318`)
- [x] Dimension 4 Typography: PASS (Strictly 4 sizes: 12px label/mono, 14px body, 20px heading, 28px display; strictly 2 weights: 400 regular, 600 semibold; line-heights 1.5 body, 1.2 heading; tabular-nums for tokens/durations)
- [x] Dimension 5 Spacing: PASS (Strictly multiples of 4 drawn from {4, 8, 16, 24, 32, 48, 64}; py-1, gap-2, p-4, px-4 py-2; exceptions: none)
- [x] Dimension 6 Registry Safety: PASS (No external shadcn registry blocks imported; custom TailAdmin primitives)
- [x] Dimension 7 Inventory Provenance: PASS (`Enumerated by ls components/ui — 12 components — clinicos@0.1.0 — 2026-11-09`)

**Approval:** approved 2026-11-09
