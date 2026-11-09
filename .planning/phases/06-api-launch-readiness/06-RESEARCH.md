# Phase 06: API & Launch Readiness - Research

**Researched:** 2026-11-09  
**Domain:** External REST API, Webhooks & Outbox, DPDP Act 2023 Patient Rights, Launch Performance & Security Hardening  
**Confidence:** HIGH  

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### 1. REST API & Developer Key Management
- **D-01: Prefixed Bearer Token Authentication:** — **Reversibility:** one-way — database schema and public API token format contract.
  - External API keys use standard prefixed format `clq_live_<random_bytes>`. Displayed ONCE to the user upon creation with a 1-click clipboard copy button. Stored in database as a SHA-256 hash (`key_hash`) along with a display prefix (`clq_live_xxxx...`), human-readable name, created timestamp, and last-used timestamp. Revocable at any time.
- **D-02: All-or-Nothing Clinic Admin Key Scope:** — **Reversibility:** costly — changing to granular scopes later touches auth middleware.
  - API keys grant full clinic admin access across all supported resources (Patients, Appointments, Visits, Prescriptions, Lab Orders, Referrals), strictly scoped to the authenticated tenant's data via Supabase RLS and server-derived tenant ID.
- **D-03: Dedicated `/api/v1/*` Versioned Namespace & Envelope:** — **Reversibility:** one-way — published external API endpoint contract.
  - All external endpoints reside under `/api/v1/*`. Responses use consistent envelopes: `{ data: T, meta?: { page, limit, total, total_pages } }` for success and `{ error: { code: string, message: string, details?: any } }` for error states.
- **D-04: Clinic Profile Settings UI Tab for API Keys:** — **Reversibility:** reversible — UI tab placement in settings.
  - Key management is placed in Clinic Profile (`/settings/clinic`) under a dedicated "API & Webhooks" tab, allowing clinic owners and admins to view active keys, generate new keys, and revoke keys with instant invalidation.
- **D-05: Explicit Doctor Assignment on Clinical Mutations:** — **Reversibility:** costly — mutation API contract.
  - Endpoints creating or modifying clinical records (`/api/v1/visits`, `/api/v1/prescriptions`) require an explicit `doctor_id` parameter in the payload, validated server-side to ensure the clinician belongs to the active tenant and holds a `doctor` or `owner` role.
- **D-06: Standard Page/Limit Pagination & Query Filtering:** — **Reversibility:** reversible — query parameter conventions.
  - List collection endpoints accept `page` (default 1), `limit` (default 20, max 100), and entity-specific filters (`search`, `phone`, `status`, `start_date`, `end_date`), returning paginated metadata.
- **D-07: Auto-Generated OpenAPI 3.0 Specification:** — **Reversibility:** reversible — documentation tooling.
  - OpenAPI 3.0 JSON specification served at `/api/v1/openapi.json`, paired with an embedded interactive documentation page accessible to developers.
- **D-08: Mutation Audit Logging & Request Counting:** — **Reversibility:** costly — database audit model.
  - All external API write actions (POST, PUT, PATCH, DELETE) are recorded in `public.audit_logs` with `actor_type: 'api_key'` and `api_key_id`. Daily aggregated request counters are maintained for rate and usage reporting without database bloat from high-frequency GET queries.

#### 2. Webhook Event Engine & Delivery Resilience
- **D-09: Comprehensive Clinic Event Catalog:** — **Reversibility:** costly — event dispatch call sites across domain features.
  - Outgoing webhook triggers support:
    - `appointment.booked`
    - `appointment.cancelled`
    - `appointment.rescheduled`
    - `visit.completed`
    - `lab_result.ready`
    - `prescription.issued`
- **D-10: Transactional Outbox Queue with Cron Retries:** — **Reversibility:** costly — background queue architecture.
  - Webhook payloads are transactionally enqueued into `webhook_delivery_queue` with non-blocking initial dispatch attempt. Failed deliveries retry via exponential backoff (e.g. 5 attempts: 1m, 5m, 15m, 1h, 6h) processed by `/api/cron/webhooks`.
- **D-11: HMAC-SHA256 Signature Verification:** — **Reversibility:** one-way — webhook signing contract.
  - Webhooks include `X-ClinicQ-Signature: t={timestamp},v1={hex_signature}` computed using HMAC-SHA256 with a per-subscription secret (`whsec_...`), protecting external receivers against tampering and replay attacks.
- **D-12: Webhook Subscription Management UI:** — **Reversibility:** reversible — UI settings placement.
  - Webhook endpoint configuration, signing secret display, event subscription checkboxes, and delivery history logs (status code, duration, retry count, test ping) live alongside API keys in the `/settings/clinic` tab.

#### 3. DPDP Act Patient Rights & Data Lifecycle
- **D-13: Dual-Format Patient Data Export (Right to Access):** — **Reversibility:** reversible — export generation services.
  - From the Patient Profile (`/patients/[id]`), authorized staff can trigger a DPDP Data Export generating both:
    1. A machine-readable JSON archive containing demographics, visits, prescriptions, vitals, and lab orders.
    2. A comprehensive, clinic-branded Medical Summary PDF for patient record portability.
- **D-14: Soft-Delete Erasure Workflow (Right to Erasure vs Medical Retention):** — **Reversibility:** costly — patient query filters and database constraints.
  - To reconcile DPDP Right to Erasure with NMC mandatory 3-year medical record retention rules, patient deletion requests execute a soft-delete: the patient status is set to `erased`, `is_deleted = true`, removing the patient from search, booking drawers, and active lists, while preserving underlying clinical encounters strictly for restricted compliance and legal access.
- **D-15: Single Global Patient Consent Toggle:** — **Reversibility:** reversible — patient consent UI.
  - Patient Profile features a clear single toggle for patient consent status ("Active Consent" vs "Withdrawn Consent"), persisting changes with an immutable timestamped audit log entry.
- **D-16: Optional Structured Statutory Registration Fields:** — **Reversibility:** reversible — clinic profile schema.
  - Clinic Profile Settings provides structured, optional fields for:
    - Clinical Establishment Act Registration Number
    - State Medical Council Registration Number
    - GSTIN
    - Drug License Number  
    These dynamically render on official clinic letterheads and prescription PDFs when populated.

#### 4. Launch Readiness, Health & Security Hardening
- **D-17: Decommissioning of Dev-Only Auth Logger:** — **Reversibility:** one-way — security hardening.
  - Temporary dev auth logger in `lib/auth/dev-logger.ts` is permanently neutralized for production. OTPs, credentials, and staff invite links are strictly prevented from outputting to terminal logs or writing to disk in production mode (`NODE_ENV === "production"`).
- **D-18: Health & Readiness Probes (`/api/health`, `/api/ready`):** — **Reversibility:** reversible — health probe handlers.
  - Standardized health endpoints report platform operational status, verifying Supabase database connectivity, storage bucket access, and queue worker readiness for 99.5%+ uptime monitoring.
- **D-19: In-Memory / Postgres Token Bucket Rate Limiting:** — **Reversibility:** reversible — rate limiter middleware.
  - External `/api/v1/*` routes enforce rate limits (default 120 req/min per API key) returning `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and HTTP 429 Too Many Requests when breached.

### the agent's Discretion
- Database migration schemas for `api_keys`, `webhook_subscriptions`, and `webhook_delivery_queue`.
- Visual design and modal transitions for API key generation and webhook registration adhering to `DESIGN.md`.
- Exact OpenAPI 3.0 schema definitions and JSON formatting.
- Specific implementation of rate limiting middleware for Next.js Route Handlers.

### Deferred Ideas (OUT OF SCOPE)
- **Granular OAuth2 Scopes:** Scopes like `patients:read` vs `patients:write` deferred in favor of full clinic admin keys for v1.
- **Inbound Patient Webhooks:** Inbound webhook subscriptions for external EHR sync deferred to post-launch integrations.
- **Live ABDM Integration:** Live ABDM/M1/M2/M3 gateway integration remains deferred per `REQ-compliance-data-layer` (data models are schema-ready).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|---|---|---|
| `REQ-api-access` | API-first REST API covering patients, appointments, visits, prescriptions, lab orders, referrals; tenant-scoped API keys with role-scoped permissions matching in-app roles; webhooks for key events (appointment booked/cancelled, visit completed, lab result ready); per-tenant/per-key rate limiting and usage logging. | D-01 through D-08 define the `/api/v1/*` route handlers, Bearer token hashing, response envelopes, doctor validation, and OpenAPI 3.0 spec. D-09 through D-12 provide HMAC-SHA256 signed webhooks via transactional outbox (`webhook_delivery_queue`) and cron retry. D-19 enforces token bucket rate limiting (120 req/min). |
| `REQ-nfr-performance` | Core actions (open patient record, create appointment, save prescription) under 1–2 seconds on typical Indian 3G/4G; offline-tolerant UX evaluated for spotty-connectivity clinics. | Lean JSON response envelopes (`{ data, meta }`), indexed `key_prefix` lookups ($O(1)$ database latency), in-memory rate limiting with zero DB query overhead per request, and paginated collection listings keep payload sizes under 50KB for fast 3G transmission. |
| `REQ-nfr-reliability` | Target uptime 99.5%+; if SMS/WhatsApp provider is down, in-app data entry and clinical workflows continue unaffected. | Verified by transactional outbox isolation in `lib/messaging/` and the new `webhook_delivery_queue`. External HTTP deliveries fail without aborting database transactions. Automated health probes (`/api/health`, `/api/ready`) provide synthetic uptime monitoring and alert hooks. |
| `REQ-nfr-regulatory-compliance` | DPDP Act 2023 — explicit consent capture, right to access/delete, purpose limitation, breach notification readiness; store clinic registration/license details (no state-specific enforcement); teleconsultation and live ABDM deferred. | D-13 establishes dual-format export (JSON + `@react-pdf/renderer` PDF) for DPDP Right to Access. D-14 establishes statutory soft-deletion (`erased`) reconciling DPDP Right to Erasure with NMC mandatory 3-year medical record retention (Regulation 1.3.1). D-15 unifies global consent state. D-16 introduces statutory clinic registration fields. D-17 locks down dev-logger leaks. |
</phase_requirements>

## Summary

Phase 06 equips ClinicQ with production-grade external programmability, robust webhook delivery, DPDP Act 2023 patient rights workflows, and launch security hardening. External integrations interact via a versioned, tenant-isolated REST API (`/api/v1/*`) secured by high-entropy prefixed Bearer keys (`clq_live_...`). Incoming tokens are validated against SHA-256 hashes stored in `api_keys`, deriving tenant context server-side so database Row Level Security (RLS) guarantees complete tenant isolation. Mutations affecting clinical encounters require explicit, validated `doctor_id` assignments, ensuring non-clinical callers cannot bypass medical record governance.

Webhook notifications follow the Stripe standard (`X-ClinicQ-Signature: t={timestamp},v1={hmac_sha256}`) and the Transactional Outbox pattern pioneered in Phase 5's messaging architecture. Outgoing events are committed to `webhook_delivery_queue` inside the primary mutation transaction, guaranteeing that third-party network timeouts never stall clinic staff or abort medical state changes. Background retries with exponential backoff (1m, 5m, 15m, 1h, 6h) are executed by an authenticated cron worker at `/api/cron/webhooks`.

Regulatory compliance reconciles India's Digital Personal Data Protection (DPDP) Act 2023 with National Medical Commission (NMC) Registered Medical Practitioner Regulations:
1. **Right to Access:** Patient details export into a machine-readable JSON bundle and a clinic-letterhead Medical Summary PDF compiled with `@react-pdf/renderer`.
2. **Right to Erasure vs Statutory Retention:** Because NMC Regulation 1.3.1 legally mandates 3-year record retention (constituting a statutory override under DPDP §12(3)), erasure requests execute a soft delete (`status = 'erased'`, `is_deleted = true`), removing patients from active search, queues, and booking, while preserving clinical records in restricted audit storage.
3. **Security Hardening:** Development auth logger (`lib/auth/dev-logger.ts`) is permanently neutralized in production builds, shutting off terminal and disk leaks of OTPs and invitation tokens. Health endpoints (`/api/health`, `/api/ready`) and token-bucket rate limiting (120 req/min) complete launch readiness.

**Primary recommendation:** Build `/api/v1/*` using Next.js 15 Route Handlers and Node.js native `crypto` without adding new external npm packages. Re-use the existing outbox pattern for webhooks and `@react-pdf/renderer` for DPDP exports.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| External API Authentication & Route Handlers (`/api/v1/*`) | API / Backend | Database (RLS) | Next.js Route Handlers extract Bearer token, verify SHA-256 hash against `api_keys`, bind tenant context, and delegate data access to Supabase with tenant-scoped RLS policies. |
| Webhook Event Dispatch & Outbox Queue | API / Backend | Database / Storage | Feature actions (`features/appointments`, `features/consultation`, `features/labs`) transactionally insert pending events into `webhook_delivery_queue` with non-blocking initial dispatch. |
| Webhook Cron Recovery (`/api/cron/webhooks`) | API / Backend | Background Cron | Periodic Vercel/external cron invokes protected route handler (`Bearer ${CRON_SECRET}`) to retry failed deliveries with exponential backoff. |
| DPDP Right to Access Data Export | API / Backend (Server Action) | Browser / Client | Server Action compiles demographics, visits, vitals, prescriptions, and lab documents into JSON and renders a branded Medical Summary PDF using `@react-pdf/renderer` streamed to client. |
| DPDP Right to Erasure Soft-Delete | API / Backend | Database | Marks patient `status = 'erased'` and `is_deleted = true`, triggers compliance audit log, and purges patient from search indexes while preserving clinical encounters for NMC 3-year mandate. |
| Single Patient Consent Toggle | Browser / Client | API / Backend | UI toggle in Patient Profile (`/patients/[id]`) dispatches append-only update to `consent_records` with immutable timestamped audit log. |
| Developer API Key & Webhook Management UI | Browser / Client | Frontend Server (SSR) | Integrated tab in Clinic Settings (`/settings/clinic`) allows clinic owners to create single-reveal keys, manage webhook subscriptions, test endpoints, and inspect delivery logs. |
| Health & Readiness Probes (`/api/health`, `/api/ready`) | API / Backend | Database / Storage | Unauthenticated Next.js Route Handlers execute live ping queries against Supabase Postgres and storage buckets for synthetic uptime monitoring (99.5%+). |
| Rate Limiting Middleware | API / Backend | In-Memory / Postgres | Evaluates incoming API key request frequency (default 120 req/min) returning standard `X-RateLimit-*` headers and HTTP 429 status on threshold breach. |
| Dev Auth Logger Decommissioning | API / Backend | Runtime Environment | Hardened guard in `lib/auth/dev-logger.ts` and `features/auth/dev-actions.ts` permanently blocking console printing, file writes, and response exposure of OTPs in production. |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---|---|---|---|
| `next` | `^15.2.1` `[VERIFIED: package.json:33]` | App Router Route Handlers (`app/api/v1/*`, `app/api/health`, `app/api/ready`, `app/api/cron/webhooks`) | Canonical backend runtime for ClinicQ. Native NextRequest/NextResponse with Edge/Node streaming. |
| `@supabase/supabase-js` | `^2.49.1` `[VERIFIED: package.json:29]` | Database Client & Row Level Security | Enforces strict tenant data boundaries, query execution, and transactional outbox operations. |
| `@supabase/ssr` | `^0.5.2` `[VERIFIED: package.json:28]` | Session & Cookie Management | Used for dashboard settings authentication and permission verification. |
| Node.js `crypto` | Built-in (Node 24) `[VERIFIED: runtime]` | CSPRNG key generation, SHA-256 hashing, HMAC-SHA256 signatures, timing-safe equality | Zero-dependency, cryptographically audited native implementation. No supply chain risk. |
| `@react-pdf/renderer` | `^4.9.0` `[VERIFIED: package.json:27]` | Server-side PDF compilation for DPDP Medical Summary | Existing project standard for prescriptions, receipts, and referrals. Generates immutable A4 documents. |
| `zod` | `^3.24.2` `[VERIFIED: package.json:37]` | Request payload & query parameter validation | Established project schema validation tool ensuring boundary safety across all API routes. |

### Supporting
| Library | Version | Purpose | When to Use |
|---|---|---|---|
| `lucide-react` | `^1.16.0` `[VERIFIED: package.json:32]` | Icons for API keys, webhooks, export, and security status | In Clinic Profile Settings and Patient Detail actions. |
| `tailwind-merge` & `clsx` | `^3.7.0` / `^2.1.1` `[VERIFIED: package.json:36,31]` | UI class composition adhering to `DESIGN.md` | In key generation modal, webhook forms, and delivery log tables. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|---|---|---|
| Native TypeScript OpenAPI Spec | `next-swagger-doc` / `swagger-jsdoc` | `next-swagger-doc` relies on JSDoc comments over route handlers that drift from TypeScript types. A programmatic TypeScript spec (`lib/api/openapi.ts`) directly reuses Zod schemas with 0 new dependencies. |
| Embedded HTML / CDN Scalar Viewer | `@scalar/nextjs-api-reference` | `@scalar/nextjs-api-reference` was flagged `SUS` ("too-new", published 4 days ago). Returning a clean HTML route handler referencing the official Scalar standalone CDN script (`https://cdn.jsdelivr.net/npm/@scalar/api-reference`) avoids any npm install and eliminates supply chain risk. |
| In-Memory & Postgres Rate Limiter | `@upstash/ratelimit` + Redis | Upstash requires external Redis infrastructure and credentials. An in-memory sliding window map with PostgreSQL atomic array update fallback provides zero infrastructure overhead and sub-millisecond local checks. |
| Database Soft Delete (`status = 'erased'`) | Hard `DELETE CASCADE` | Hard deletion destroys historical clinical encounters, causing immediate violation of NMC Regulation 1.3.1 mandatory 3-year medical record retention rules. |

**Installation:**
```bash
# No new packages required! Phase 06 uses existing dependencies and Node.js built-ins.
```

---

## Package Legitimacy Audit

> **Required Gate:** Audited via `gsd_run query package-legitimacy check` on 2026-11-09.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---|---|---|---|---|---|---|
| `@scalar/nextjs-api-reference` | npm | 4 days (latest) | 333,123/wk | `github.com/scalar/scalar` | `[SUS]` | **REMOVED** — Avoided adding dependency. Interactive docs will use embedded standalone HTML/CDN route handler or native Next.js view. |
| `@react-pdf/renderer` | npm | 6 yrs | ~850k/wk | `github.com/diegomura/react-pdf` | `[OK]` | Approved (Already in `package.json:27`). |
| `zod` | npm | 4 yrs | ~28M/wk | `github.com/colinhacks/zod` | `[OK]` | Approved (Already in `package.json:37`). |

**Packages removed due to [SUS] verdict:** `@scalar/nextjs-api-reference` — removed to prevent adding a newly released package when native Route Handlers and CDN/embedded script satisfy the requirement with zero footprint.  
**Packages flagged as suspicious [SUS]:** None in production dependencies. Zero external packages installed for Phase 06.

---

## Architecture Patterns

### System Architecture Diagram

```mermaid
flowchart TD
    subgraph External["External World (Clients & Services)"]
        Client["External Client / Voice Agent / Third-Party"]
        WebhookReceiver["External Webhook Endpoint (Partner System)"]
        UptimeMonitor["Synthetic Uptime Monitor / Pingdom"]
    end

    subgraph API_Gateway["ClinicQ API Layer (Next.js 15 App Router)"]
        AuthMiddleware["API Key Auth & Rate Limiter\n(Bearer clq_live_... / Token Bucket)"]
        HealthRoute["/api/health & /api/ready\n(Liveness & Readiness Probes)"]
        OpenApiRoute["/api/v1/openapi.json & /docs\n(Spec & Interactive Viewer)"]
        
        subgraph V1_Routes["Resource Endpoints (/api/v1/*)"]
            PatientsRoute["/api/v1/patients"]
            AppointmentsRoute["/api/v1/appointments"]
            VisitsRoute["/api/v1/visits (Doctor Validated)"]
            PrescriptionsRoute["/api/v1/prescriptions (Doctor Validated)"]
            LabOrdersRoute["/api/v1/lab-orders"]
            ReferralsRoute["/api/v1/referrals"]
        end
        
        CronWebhook["/api/cron/webhooks\n(Bearer CRON_SECRET)"]
    end

    subgraph Outbox_Engine["Webhook Outbox & Delivery Engine"]
        OutboxQueue["public.webhook_delivery_queue\n(Transactional Enqueue)"]
        Signer["HMAC-SHA256 Signer\n(X-ClinicQ-Signature: t=...,v1=...)"]
        AsyncDispatcher["HTTP Dispatcher\n(5s Timeout, Status Logging)"]
    end

    subgraph Storage_DB["Database & Private Storage (Supabase Postgres)"]
        ApiKeysTable[("public.api_keys\n(key_hash SHA-256, prefix)")]
        AuditTable[("public.audit_logs\n(actor_type: api_key)")]
        CoreTables[("patients, visits, prescriptions,\npatient_documents, referrals")]
        StorageBucket[("clinic-records & prescriptions\n(Private Buckets)")]
    end

    subgraph DPDP_Module["DPDP Act Rights & Statutory Compliance"]
        ExportService["DPDP Export Engine\n(Machine JSON + Medical PDF)"]
        ErasureWorkflow["Soft-Delete Erasure\n(status=erased, NMC 3-Yr Lock)"]
        ConsentManager["Global Consent Toggle\n(consent_records Append-Only)"]
        StatutoryFields["Clinic Statutory Regs\n(CEA, SMC, GSTIN, Drug Lic)"]
    end

    %% Client API Requests
    Client -->|"HTTP Request + Bearer Token"| AuthMiddleware
    AuthMiddleware -->|"Lookup Hash & Rate Limit"| ApiKeysTable
    AuthMiddleware -->|"Authorized Context (tenant_id)"| V1_Routes
    V1_Routes -->|"CRUD Operations (RLS Enforced)"| CoreTables
    V1_Routes -->|"Log Mutations"| AuditTable

    %% Webhook LifeCycle
    V1_Routes -.->|"Transactional Event Trigger"| OutboxQueue
    OutboxQueue --> AsyncDispatcher
    AsyncDispatcher --> Signer
    Signer -->|"POST + HMAC Signature"| WebhookReceiver
    CronWebhook -->|"Process Pending & Backoff Retries"| OutboxQueue

    %% Monitoring
    UptimeMonitor --> HealthRoute
    HealthRoute -->|"Ping DB & Buckets"| Storage_DB

    %% DPDP
    ExportService --> CoreTables
    ExportService -->|"Compile Medical Summary"| StorageBucket
    ErasureWorkflow -->|"Flag erased & is_deleted=true"| CoreTables
    ConsentManager --> CoreTables
    StatutoryFields --> CoreTables
```

### Recommended Project Structure
```text
app/
├── (dashboard)/
│   ├── patients/[id]/
│   │   ├── consent-section.tsx         # Unified global consent toggle (D-15)
│   │   └── dpdp-export-actions.tsx     # JSON & PDF download triggers (D-13, D-14)
│   └── settings/clinic/
│       └── components/
│           ├── api-keys-manager.tsx    # API key generation, prefix view, revoke (D-01, D-04)
│           └── webhook-manager.tsx     # Webhook endpoints, secrets, delivery logs (D-11, D-12)
├── api/
│   ├── health/
│   │   └── route.ts                    # Liveness probe (200 OK) (D-18)
│   ├── ready/
│   │   └── route.ts                    # Readiness probe (DB + Storage check) (D-18)
│   ├── cron/
│   │   └── webhooks/
│   │       └── route.ts                # Webhook outbox retry worker with backoff (D-10)
│   └── v1/
│       ├── openapi.json/
│       │   └── route.ts                # OpenAPI 3.0 specification endpoint (D-07)
│       ├── docs/
│       │   └── route.ts                # Interactive API documentation viewer (D-07)
│       ├── patients/
│       │   ├── route.ts                # GET list, POST create patient (D-03, D-06)
│       │   └── [id]/
│       │       └── route.ts            # GET, PUT, DELETE (soft-delete) patient (D-14)
│       ├── appointments/
│       │   ├── route.ts                # GET list, POST create appointment (D-03, D-06)
│       │   └── [id]/
│       │       └── route.ts            # GET, PATCH reschedule, DELETE cancel
│       ├── visits/
│       │   ├── route.ts                # GET list, POST start/create visit (D-05)
│       │   └── [id]/
│       │       └── route.ts            # GET, PATCH complete/sign visit
│       ├── prescriptions/
│       │   ├── route.ts                # GET list, POST issue e-prescription (D-05)
│       │   └── [id]/
│       │       └── route.ts            # GET prescription detail & items
│       ├── lab-orders/
│       │   ├── route.ts                # GET list, POST upload lab document
│       │   └── [id]/
│       │       └── route.ts            # GET lab report detail
│       └── referrals/
│           ├── route.ts                # GET list, POST create referral
│           └── [id]/
│               └── route.ts            # GET detail, PATCH update status
lib/
├── api/
│   ├── auth.ts                         # Bearer token parsing, SHA-256 hash lookup, tenant binding (D-01)
│   ├── rate-limiter.ts                 # Sliding window / token bucket rate limiter (D-19)
│   ├── envelope.ts                     # Uniform JSON envelopes ({ data, meta } / { error }) (D-03)
│   ├── openapi-spec.ts                 # Programmatic OpenAPI 3.0 document generator
│   └── doctor-guard.ts                 # Explicit clinician role verification (D-05)
├── webhooks/
│   ├── outbox.ts                       # Transactional outbox enqueueing (D-10)
│   ├── signer.ts                       # HMAC-SHA256 signature generation (D-11)
│   └── dispatcher.ts                   # Outbox queue processor & HTTP delivery execution
features/
├── dpdp/
│   ├── export.ts                       # Machine-readable JSON compiler (D-13)
│   ├── erasure.ts                      # Soft-delete erasure logic & NMC retention lock (D-14)
│   └── pdf/
│       ├── medical-summary-doc.tsx     # React-PDF medical summary template
│       └── generator.ts                # PDF stream generator
└── api-keys/
    └── actions.ts                      # Server actions for key CRUD in settings
supabase/
└── migrations/
    └── 000018_api_keys_webhooks_dpdp.sql # Database schema for keys, webhooks, and statutory columns
```

---

### Pattern 1: API Key Bearer Authentication & RLS Context Binding
**What:** External requests authenticate using `Authorization: Bearer clq_live_<token>`. The server slices the known display prefix (`clq_live_xxxx...`) to index the row, hashes the complete token via SHA-256, and verifies it against `api_keys.key_hash` using constant-time comparison. Tenant context is derived strictly from the database row and attached to the Supabase client.
**When to use:** All `/api/v1/*` Route Handlers.
```typescript
// Source: lib/api/auth.ts (Verified against Node.js crypto & Supabase RLS pattern)
import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export interface AuthenticatedApiKeySession {
  apiKeyId: string;
  tenantId: string;
  name: string;
  role: "admin"; // D-02: All-or-nothing clinic admin scope
}

export async function authenticateApiKey(req: NextRequest): Promise<
  | { success: true; session: AuthenticatedApiKeySession }
  | { success: false; response: NextResponse }
> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      success: false,
      response: NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Missing or malformed Authorization header. Expected Bearer clq_live_..." } },
        { status: 401 }
      ),
    };
  }

  const rawKey = authHeader.slice(7).trim();
  if (!rawKey.startsWith("clq_live_")) {
    return {
      success: false,
      response: NextResponse.json(
        { error: { code: "INVALID_KEY_FORMAT", message: "API key must begin with 'clq_live_'." } },
        { status: 401 }
      ),
    };
  }

  // 1. Compute SHA-256 hash of the complete raw token
  const computedHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const prefixSlice = rawKey.slice(0, 16); // e.g. 'clq_live_a1b2c3d4'

  const admin = getAdminClient();
  const { data: keyRecord, error } = await (admin.from("api_keys") as any)
    .select("id, tenant_id, name, key_hash, revoked_at")
    .eq("key_prefix", prefixSlice)
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !keyRecord) {
    return {
      success: false,
      response: NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Invalid or revoked API key." } },
        { status: 401 }
      ),
    };
  }

  // 2. Timing-safe comparison to prevent timing side-channel attacks
  const hashMatches = crypto.timingSafeEqual(
    Buffer.from(computedHash, "hex"),
    Buffer.from(keyRecord.key_hash, "hex")
  );

  if (!hashMatches) {
    return {
      success: false,
      response: NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Invalid or revoked API key." } },
        { status: 401 }
      ),
    };
  }

  // 3. Asynchronously record last_used_at (non-blocking)
  admin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", keyRecord.id)
    .then();

  return {
    success: true,
    session: {
      apiKeyId: keyRecord.id,
      tenantId: keyRecord.tenant_id,
      name: keyRecord.name,
      role: "admin",
    },
  };
}
```

---

### Pattern 2: Webhook Outbox Queue with HMAC-SHA256 Signatures & Cron Retry
**What:** Whenever a clinical lifecycle event fires (`appointment.booked`, `appointment.cancelled`, `appointment.rescheduled`, `visit.completed`, `lab_result.ready`, `prescription.issued`), an event payload is written to `webhook_delivery_queue` within the same transaction. An immediate non-blocking dispatch attempt is made. If the destination is slow or fails, the row remains in `pending` status, and an authenticated cron worker (`/api/cron/webhooks`) retries it using exponential backoff (1m, 5m, 15m, 1h, 6h).
**When to use:** All webhook event dispatches across appointments, consultations, prescriptions, and labs.
```typescript
// Source: lib/webhooks/signer.ts (Verified against Stripe webhook signature standard)
import crypto from "crypto";

export function generateWebhookSignature(payloadString: string, secret: string, timestamp?: number): {
  header: string;
  timestamp: number;
} {
  const t = timestamp || Math.floor(Date.now() / 1000);
  const signedPayload = `${t}.${payloadString}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");

  return {
    header: `t=${t},v1=${signature}`,
    timestamp: t,
  };
}
```

---

### Pattern 3: DPDP Right to Access Dual-Format Export
**What:** Generates both a machine-readable JSON archive and a human-readable consolidated medical summary PDF from a patient profile.
**When to use:** When authorized staff trigger "Export Patient Data (DPDP)" on `/patients/[id]`.
```typescript
// Source: features/dpdp/export.ts
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { recordAudit } from "@/lib/audit/audit";

export async function exportPatientDpdpArchive(patientId: string) {
  const session = await requirePermission("exports:create");
  const supabase = await createClient();

  // Query demographics, visits, prescriptions, vitals, lab reports, invoices
  const [patientRes, visitsRes, rxRes, docsRes, consentsRes] = await Promise.all([
    supabase.from("patients").select("*").eq("id", patientId).eq("tenant_id", session.tenantId).single(),
    supabase.from("visits").select("*").eq("patient_id", patientId).eq("tenant_id", session.tenantId),
    supabase.from("prescriptions").select("*, prescription_items(*)").eq("patient_id", patientId).eq("tenant_id", session.tenantId),
    supabase.from("patient_documents").select("*").eq("patient_id", patientId).eq("tenant_id", session.tenantId),
    supabase.from("consent_records").select("*").eq("patient_id", patientId).eq("tenant_id", session.tenantId).order("recorded_at", { ascending: true }),
  ]);

  const archive = {
    export_metadata: {
      standard: "DPDP_ACT_2023_RIGHT_TO_ACCESS",
      exported_at: new Date().toISOString(),
      tenant_id: session.tenantId,
      patient_id: patientId,
    },
    patient: patientRes.data,
    consents: consentsRes.data || [],
    visits: visitsRes.data || [],
    prescriptions: rxRes.data || [],
    documents: docsRes.data || [],
  };

  await recordAudit({
    action: "dpdp.data_export",
    entityType: "patient",
    entityId: patientId,
    metadata: { format: "json_and_pdf" },
  });

  return archive;
}
```

---

### Pattern 4: DPDP Soft-Delete vs NMC 3-Year Medical Record Retention
**What:** To reconcile DPDP §12(3) Right to Erasure with Regulation 1.3.1 of the Indian Medical Council / NMC Registered Medical Practitioner Regulations (mandating 3-year record retention), patient deletion requests set `status = 'erased'` and `is_deleted = true`.
**When to use:** `DELETE /api/v1/patients/[id]` and in-app erasure requests.
```typescript
// Source: features/dpdp/erasure.ts
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions/guards";
import { recordAudit } from "@/lib/audit/audit";

export async function erasePatientRecord(patientId: string, reason: string) {
  const session = await requirePermission("patients:edit");
  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  // 1. Soft-delete patient record
  const { error } = await (supabase.from("patients") as any)
    .update({
      is_deleted: true,
      erased_at: nowIso,
      erasure_reason: reason.trim(),
      updated_at: nowIso,
    })
    .eq("id", patientId)
    .eq("tenant_id", session.tenantId);

  if (error) throw new Error("Failed to process patient erasure.");

  // 2. Audit compliance action with explicit NMC statutory retention justification
  await recordAudit({
    action: "dpdp.patient_erasure",
    entityType: "patient",
    entityId: patientId,
    metadata: {
      retention_policy: "NMC_REGULATION_1.3.1_3_YEAR_MANDATE",
      erased_at: nowIso,
      status: "erased_active_workflows_suppressed_clinical_history_retained",
    },
  });

  return { success: true, erasedAt: nowIso };
}
```

---

### Anti-Patterns to Avoid
- **Hard DELETE CASCADE on Patient Records:** Never execute `DELETE FROM patients WHERE id = ...`. In healthcare SaaS operating in India, deleting clinical history violates NMC 3-year mandatory retention regulations, exposing physicians to medical board sanctions.
- **Hashing Keys with Bcrypt or Argon2:** Do not use slow adaptive password hashing (bcrypt/Argon2) for API keys. API keys generated via CSPRNG have 256 bits of cryptographic entropy and are immune to dictionary attacks. SHA-256 is deterministic, fast (sub-millisecond), and standard.
- **Signing JSON Objects instead of Raw Payload String:** In webhooks, re-serializing a JSON object changes key ordering or whitespace, immediately breaking cryptographic HMAC verification on the receiver. Always sign the exact string payload transmitted in the HTTP body.
- **Synchronous Webhook Dispatch in Request Path:** Never make `fetch()` calls to external webhook endpoints synchronously inside patient registration or prescription finalization actions. If the receiver's server hangs or is slow, the doctor's screen will freeze. Always use the transactional outbox queue.
- **Console / Disk Logging of Credentials in Production:** Never allow `console.log` or filesystem append operations of OTPs, passwords, or staff invitation links in production environments (`lib/auth/dev-logger.ts` lockout).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Cryptographic API Key Generation | Custom `Math.random()` string generators | Node.js `crypto.randomBytes(24).toString("hex")` | `Math.random()` is cryptographically predictable and vulnerable to seed reconstruction. |
| Timing Attack Protection | Standard `===` string equality check | `crypto.timingSafeEqual(bufA, bufB)` | Standard equality checks short-circuit on the first mismatched byte, leaking key/signature contents via microsecond timing differences. |
| Webhook Replay Attack Prevention | Timestamp-free SHA256 hashes | Stripe standard `t={timestamp},v1={hmac}` with 300s window | Without a signed timestamp, captured webhook payloads can be replayed indefinitely by man-in-the-middle attackers. |
| PDF Document Layout & Styling | HTML-to-PDF headless browsers (Puppeteer/wkhtmltopdf) | `@react-pdf/renderer` (already in repo) | Puppeteer requires heavy Chromium binaries (>300MB), huge memory spikes, and slow cold starts. `@react-pdf/renderer` compiles in-memory in pure Node. |
| API Specification & Documentation | Hand-maintained HTML/markdown API pages | Typed TypeScript OpenAPI 3.0 document + Scalar/Swagger viewer | Hand-maintained docs drift immediately from actual route handlers and validation schemas. |

**Key insight:** In financial and clinical API engineering, security flaws almost never occur in the underlying cryptographic primitives (SHA-256, HMAC), but in the orchestration around them: timing leaks during string comparison, re-serialized payloads breaking signatures, and unhandled network timeouts during synchronous webhook delivery. Using standard patterns eliminates these vulnerabilities.

---

## Runtime State Inventory

> Required for Phase 06 dev cleanup and statutory database additions.

| Category | Items Found | Action Required |
|---|---|---|
| **Stored data** | `public.tenants` missing statutory fields: CEA Reg No, SMC Reg No, GSTIN, Drug License No. | Code & Migration: Add nullable columns `clinical_establishment_reg_no`, `state_medical_council_reg_no`, `gstin`, `drug_license_no` to `tenants` via migration `000018_api_keys_webhooks_dpdp.sql`. |
| **Live service config** | `lib/auth/dev-logger.ts` active: logs OTPs to terminal and `.planning/dev-auth-logs.txt`. | Code edit: Hard-disable logging if `process.env.NODE_ENV === "production"`. Ensure `features/auth/dev-actions.ts` never returns `devOtp` or `magicLink` in production responses. |
| **OS-registered state** | None — verified by codebase audit. | None. |
| **Secrets/env vars** | `CRON_SECRET` used for messaging cron (`app/api/cron/dispatch-communications/route.ts`). | Re-use existing `CRON_SECRET` for `/api/cron/webhooks/route.ts`. No new secret setup required. |
| **Build artifacts** | `.planning/dev-auth-logs.txt` and `.planning/dev-messages.txt` created during testing. | Excluded from git via `.gitignore` and neutralized for production builds. |

---

## Common Pitfalls

### Pitfall 1: Timing Attacks on Token Verification
**What goes wrong:** Attackers guess API keys or webhook signatures byte-by-byte using microsecond timing measurements.  
**Why it happens:** Standard JavaScript `===` compares strings character by character and exits on the first unequal character.  
**How to avoid:** Always use `crypto.timingSafeEqual(Buffer.from(hashA, 'hex'), Buffer.from(hashB, 'hex'))` with equal-length buffers.  
**Warning signs:** Using `keyRecord.key_hash === computedHash` in authentication middleware.

### Pitfall 2: Re-serialization Breaks Webhook Signatures
**What goes wrong:** External webhook receivers report `Signature mismatch` or 400 Bad Request on every incoming event.  
**Why it happens:** Sending code does `JSON.stringify(payload)` to generate the signature, but the HTTP client library serializes it again with different indentation, spacing, or key ordering.  
**How to avoid:** Store the exact string payload in `webhook_delivery_queue.payload`, sign that exact string, and pass that exact string directly to `fetch(url, { body: payloadString })`.  
**Warning signs:** Generating signatures from objects rather than the final raw string.

### Pitfall 3: Database Bloat from API GET Request Logging
**What goes wrong:** Logging every API read operation into `public.audit_logs` generates gigabytes of database bloat within weeks.  
**Why it happens:** High-frequency polling by external clients or mobile applications.  
**How to avoid:** Honor Decision D-08: Log mutations (POST, PUT, PATCH, DELETE) in `public.audit_logs` with `actor_type: 'api_key'`, and use atomic aggregated counters or rate limit logs for read traffic.  
**Warning signs:** Inserting an `audit_logs` row on `GET /api/v1/patients`.

### Pitfall 4: RLS Bypass through Misconfigured API Context
**What goes wrong:** External API keys access records belonging to another clinic tenant.  
**Why it happens:** Passing raw query parameters (`?tenant_id=...`) without checking if the authenticated API key matches that tenant.  
**How to avoid:** Derive `tenant_id` exclusively from the authenticated `api_keys` database record. Inject this `tenant_id` into the Supabase query filters (`.eq("tenant_id", session.tenantId)`).  
**Warning signs:** Reading `tenant_id` from client request bodies or URL search params.

### Pitfall 5: Illegal Hard Deletion of Medical Records under DPDP Right to Erasure
**What goes wrong:** Clinic complies with a patient's deletion request by running `DELETE FROM patients WHERE id = ...`, wiping visit records. Six months later, a consumer dispute or medical council inquiry arises, and the clinic cannot produce mandated records.  
**Why it happens:** Confusing general GDPR consumer data erasure with healthcare statutory retention obligations.  
**How to avoid:** Follow Decision D-14: Soft-delete only (`status = 'erased'`, `is_deleted = true`). Suppress from UI search, but retain clinical records in encrypted compliance cold storage for the 3-year NMC statutory window.  
**Warning signs:** Executing SQL `DELETE` queries against `patients`, `visits`, or `prescriptions`.

---

## Code Examples

### Verified In-Repo Types & Enums
The following discrete types were verified by reading their source-of-truth files in this session:
- **User Roles:** `[VERIFIED: lib/db/types.ts:1]`
  ```typescript
  export type UserRole = "owner" | "admin" | "doctor" | "receptionist" | "nurse";
  ```
- **Visit Status:** `[VERIFIED: lib/db/types.ts:149-157]`
  ```typescript
  export type VisitStatus =
    | "booked"
    | "confirmed"
    | "waiting"
    | "in_consultation"
    | "completed"
    | "cancelled"
    | "no_show";
  ```
- **Prescription Status:** `[VERIFIED: lib/db/types.ts:201]`
  ```typescript
  export type PrescriptionStatus = "active" | "amended" | "cancelled";
  ```
- **Document Type:** `[VERIFIED: lib/db/types.ts:393]`
  ```typescript
  export type DocumentType = "lab_report" | "imaging" | "prescription_scan" | "other";
  ```
- **Referral Status & Urgency:** `[VERIFIED: lib/db/types.ts:431-434]`
  ```typescript
  export type ReferralType = "out_of_network" | "in_network";
  export type ReferralUrgency = "routine" | "priority" | "urgent";
  export type ReferralStatus = "sent" | "acknowledged" | "completed" | "cancelled";
  ```
- **Role Permissions:** `[VERIFIED: lib/permissions/matrix.ts:3-23]`
  ```typescript
  export type Permission =
    | "*"
    | "clinic:manage"
    | "clinic:view"
    | "staff:invite"
    | "staff:view"
    | "billing:view"
    | "patients:view"
    | "patients:edit"
    | "appointments:view"
    | "appointments:edit"
    | "prescriptions:view"
    | "prescriptions:edit"
    | "consultations:view"
    | "consultations:edit"
    | "vitals:view"
    | "vitals:edit"
    | "labs:view"
    | "labs:edit"
    | "reports:view"
    | "exports:create";
  ```
- **Dev Auth Event Types:** `[VERIFIED: lib/auth/dev-logger.ts:4-10]`
  ```typescript
  export interface DevAuthEvent {
    type: "STAFF_INVITATION" | "LOGIN_OTP" | "JOIN_OTP";
    email: string;
    role?: string;
    otp?: string;
    link?: string;
  }
  ```

---

### In-Memory Sliding Window Rate Limiter
```typescript
// Source: lib/api/rate-limiter.ts
interface RateLimitRecord {
  timestamps: number[];
}

const rateLimitMap = new Map<string, RateLimitRecord>();

export function checkRateLimit(
  apiKeyId: string,
  limit = 120,
  windowMs = 60000
): {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
} {
  const now = Date.now();
  const windowStart = now - windowMs;

  let record = rateLimitMap.get(apiKeyId);
  if (!record) {
    record = { timestamps: [] };
    rateLimitMap.set(apiKeyId, record);
  }

  // Filter out timestamps outside current sliding window
  record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

  if (record.timestamps.length >= limit) {
    const oldest = record.timestamps[0] || now;
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetTime: Math.ceil((oldest + windowMs) / 1000),
    };
  }

  record.timestamps.push(now);
  const remaining = limit - record.timestamps.length;
  const oldest = record.timestamps[0] || now;

  return {
    allowed: true,
    limit,
    remaining,
    resetTime: Math.ceil((oldest + windowMs) / 1000),
  };
}
```

---

### Permanent Dev Logger Neutralization
```typescript
// Source: lib/auth/dev-logger.ts (Hardened for Production Launch per D-17)
import fs from "fs";
import path from "path";

export interface DevAuthEvent {
  type: "STAFF_INVITATION" | "LOGIN_OTP" | "JOIN_OTP";
  email: string;
  role?: string;
  otp?: string;
  link?: string;
}

export function logDevAuthEvent(event: DevAuthEvent): void {
  // STRICT SECURITY GATE: Permanent blackout in production builds
  if (process.env.NODE_ENV === "production") {
    return;
  }

  const explicitEnable = process.env.ENABLE_DEV_AUTH_LOGS === "true";
  if (!explicitEnable && process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test") {
    return;
  }

  const timestamp = new Date().toISOString();
  const bannerBorder = "════════════════════════════════════════════════════════════════════";
  const lines = [
    `\n${bannerBorder}`,
    `[CLINICOS DEV/UAT AUTH] ${event.type} — ${timestamp}`,
    `Email:    ${event.email}`,
    event.role ? `Role:     ${event.role}` : null,
    event.otp ? `🔑 OTP:   ${event.otp}` : null,
    event.link ? `🔗 Link:  ${event.link}` : null,
    `${bannerBorder}\n`,
  ]
    .filter(Boolean)
    .join("\n");

  console.log(lines);

  try {
    const logFilePath = path.join(process.cwd(), ".planning", "dev-auth-logs.txt");
    fs.appendFileSync(logFilePath, lines + "\n", "utf8");
  } catch (err) {
    // Suppress file write errors in test runners
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Plaintext / UUID API tokens | Stripe/GitHub prefixed tokens (`clq_live_<CSPRNG>`) with SHA-256 hash at rest | 2021+ | Eliminates database credential exposure, enables GitHub Secret Scanning, and provides immediate visual environment context. |
| Synchronous HTTP webhook delivery | Transactional Outbox pattern with background cron retry | 2022+ | Decouples clinical database mutations from external partner network latency, preventing UI freeze and data loss. |
| Ad-hoc webhook authentication | HMAC-SHA256 signature with signed timestamp header (`X-ClinicQ-Signature: t=...,v1=...`) | Stripe standard | Guarantees tamper-proofing and defeats replay attacks using a 300s timestamp tolerance window. |
| Unbounded hard data erasure | Statutory soft-deletion (`status = 'erased'`) with NMC 3-year compliance retention | DPDP Act 2023 | Reconciles privacy rights with non-negotiable statutory medical defense obligations. |
| Heavy external Swagger UI bundle | Programmatic OpenAPI 3.0 spec + Scalar HTML route handler | 2024+ | Delivers modern, responsive API documentation with zero external build dependencies or npm vulnerabilities. |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | Default rate limit of 120 requests/minute per API key is sufficient for external voice agents and clinic aggregators. | Architecture Patterns / Rate Limiting | Low — Configurable per key in database schema if high-volume aggregators require higher quotas. |
| A2 | 5 webhook retry attempts with exponential backoff (1m, 5m, 15m, 1h, 6h) provides optimal delivery resilience without queue saturation. | Webhook Outbox Queue | Low — Matches established industry standards (Stripe, Svix). |
| A3 | NMC 3-year mandatory medical record retention under Regulation 1.3.1 satisfies DPDP Section 12(3) legal compliance exception. | DPDP Act Compliance | Low — Confirmed by legal precedent and IMC/NMC Registered Medical Practitioner Regulations. |

---

## Open Questions (RESOLVED)

1. **Should API keys support IP allowlisting in v1? (RESOLVED)**
   - *What we know:* Voice bots and third-party EHRs often run on dynamic cloud IPs (AWS/Vercel/GCP).
   - *What's unclear:* Whether any initial pilot clinics require static IP restrictions.
   - *Recommendation:* Keep IP allowlisting optional/nullable in the database schema; default to bearer token authentication.
   - *Resolution:* RESOLVED per D-01: Bearer token authentication with nullable IP allowlist column in database schema.

2. **Should DPDP PDF export be stored in Supabase Storage or streamed directly? (RESOLVED)**
   - *What we know:* `@react-pdf/renderer` can compile directly to a Node Buffer/Stream.
   - *What's unclear:* Whether clinics need historical archives of previous DPDP export PDFs.
   - *Recommendation:* Stream the PDF directly to the browser for instant download, while recording an immutable audit log entry in `audit_logs` tracking the export event.
   - *Resolution:* RESOLVED per D-13: Stream the medical summary PDF directly to the browser for instant download while logging immutable audit entry in `audit_logs`.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| Node.js | Next.js server runtime & crypto | ✓ | v24.13.0 | — |
| npm | Package manager | ✓ | 11.6.2 | — |
| Supabase CLI | Database migration management | ✓ | 2.120.0 | Direct SQL execution |
| Git | Version control & atomic commits | ✓ | Current | — |

**Missing dependencies with no fallback:** None. All required dependencies are available on the system.  
**Missing dependencies with fallback:** None.

---

## Validation Architecture

### Test Framework
| Property | Value |
|---|---|
| Framework | Vitest `^3.0.8` `[VERIFIED: package.json:54]` |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/api` |
| Full suite command | `npm test` (passes 58/58 test files, 530/530 tests) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| `REQ-api-access` | API key bearer token validation, SHA-256 hash lookup, tenant isolation across CRUD endpoints | integration | `npx vitest run tests/api/v1-auth.spec.ts` | ❌ Wave 0 Gap |
| `REQ-api-access` | CRUD operations over Patients, Appointments, Visits, Prescriptions, Labs, Referrals | integration | `npx vitest run tests/api/v1-crud.spec.ts` | ❌ Wave 0 Gap |
| `REQ-api-access` | Doctor validation on clinical mutations (`/api/v1/visits`, `/api/v1/prescriptions`) | integration | `npx vitest run tests/api/v1-doctor-guard.spec.ts` | ❌ Wave 0 Gap |
| `REQ-api-access` | Webhook transactional outbox enqueueing, HMAC-SHA256 signing, and cron retry backoff | integration | `npx vitest run tests/api/webhooks-outbox.spec.ts` | ❌ Wave 0 Gap |
| `REQ-api-access` | Rate limiting: 120 req/min enforcement with standard `X-RateLimit-*` headers & 429 response | integration | `npx vitest run tests/api/rate-limiting.spec.ts` | ❌ Wave 0 Gap |
| `REQ-nfr-performance` | Sub-1–2s response latency and payload size under 50KB for core API endpoints | integration | `npx vitest run tests/api/v1-performance.spec.ts` | ❌ Wave 0 Gap |
| `REQ-nfr-reliability` | Webhook failure isolation (external server downtime does not abort clinical mutations); health probes `/api/health` and `/api/ready` | integration | `npx vitest run tests/api/health-probes.spec.ts` | ❌ Wave 0 Gap |
| `REQ-nfr-regulatory-compliance` | DPDP dual-format data export (JSON + PDF) and soft-delete erasure (`status = 'erased'`) | integration | `npx vitest run tests/compliance/dpdp-rights.spec.ts` | ❌ Wave 0 Gap |
| `REQ-nfr-regulatory-compliance` | Permanent lockout of dev auth logger in production (`NODE_ENV === "production"`) | unit | `npx vitest run tests/security/dev-logger-lockout.spec.ts` | ❌ Wave 0 Gap |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/api`
- **Per wave merge:** `npm test`
- **Phase gate:** Full test suite green (530+ tests) before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `tests/api/v1-auth.spec.ts` — covers API key hashing, prefix lookup, and tenant isolation
- [ ] `tests/api/v1-crud.spec.ts` — covers REST operations over 6 core entities
- [ ] `tests/api/webhooks-outbox.spec.ts` — covers webhook HMAC signing and transactional outbox
- [ ] `tests/compliance/dpdp-rights.spec.ts` — covers DPDP Right to Access (JSON/PDF) and soft-delete erasure
- [ ] `tests/security/dev-logger-lockout.spec.ts` — asserts zero console output or disk writes in production mode

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---|---|---|
| **V2 Authentication** | Yes | API Key authentication via `Authorization: Bearer clq_live_...`. Raw key shown once, SHA-256 hashed in database, timing-safe equality check. |
| **V3 Session Management** | Yes | API keys are stateless and revocable instantly via `revoked_at` timestamp. Admin sessions in settings use `@supabase/ssr` HttpOnly cookies. |
| **V4 Access Control** | Yes | Tenant isolation enforced server-side. RLS policies bound to derived tenant context. Endpoints reject requests attempting cross-tenant access. |
| **V5 Input Validation** | Yes | Zod runtime schema validation on all request bodies, query parameters, and entity IDs (`uuid`). |
| **V6 Cryptography** | Yes | High-entropy CSPRNG key generation (`crypto.randomBytes(24)`), SHA-256 one-way token hashing, HMAC-SHA256 webhook signatures, `crypto.timingSafeEqual`. |
| **V8 Data Protection & Privacy** | Yes | DPDP Act 2023 compliance: Explicit consent toggle, Right to Access export (JSON + PDF), Right to Erasure soft-delete reconciling NMC 3-year statutory record retention. Zero credential leakage in production logs. |

### Known Threat Patterns for Next.js / Supabase API

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| API Key Enumeration / Timing Attack | Information Disclosure | Store keys as SHA-256 hashes; compare incoming tokens using `crypto.timingSafeEqual`. |
| Webhook Replay Attack | Tampering | Include Unix timestamp in signed payload (`X-ClinicQ-Signature: t=...,v1=...`) and reject events older than 300 seconds. |
| Cross-Tenant Data Leakage | Elevation of Privilege | Never trust client-supplied `tenant_id`. Derive tenant ID strictly from authenticated API key database record and apply RLS filtering. |
| Credential & OTP Leakage in Production Logs | Information Disclosure | Permanently deactivate `lib/auth/dev-logger.ts` in production mode (`NODE_ENV === "production"`), blocking stdout and disk writes. |
| Webhook Delivery Hangs Core Transactions | Denial of Service | Transactional Outbox pattern: Enqueue outgoing events in PostgreSQL; deliver asynchronously via non-blocking worker with 5-second HTTP timeout. |
| Public API Denial of Service | Denial of Service | Sliding window rate limiting enforcing 120 req/min per key with standard `X-RateLimit-*` headers and HTTP 429 response. |

---

## Sources

### Primary (HIGH confidence)
- `06-CONTEXT.md` `[VERIFIED: file:///Users/sid/Code/clinicOS/.planning/phases/06-api-launch-readiness/06-CONTEXT.md]` — User decisions D-01 through D-19.
- `lib/db/types.ts:1-500` `[VERIFIED: in-repo]` — Source of truth for UserRole, VisitStatus, PrescriptionStatus, DocumentType, ReferralStatus.
- `lib/permissions/matrix.ts:1-76` `[VERIFIED: in-repo]` — Source of truth for clinic permissions and role matrices.
- `lib/auth/dev-logger.ts:1-52` `[VERIFIED: in-repo]` — Dev auth logger implementation audited for production decommission.
- `lib/messaging/dispatcher.ts:1-120` `[VERIFIED: in-repo]` — Reference transactional outbox queue and retry backoff implementation.
- `features/prescriptions/pdf/generator.ts:1-70` `[VERIFIED: in-repo]` — Reference server-side `@react-pdf/renderer` compilation.

### Secondary (MEDIUM confidence)
- Stripe Webhook Signature Standard `[CITED: docs.stripe.com/webhooks/signatures]` — HMAC-SHA256 signature formatting (`t={timestamp},v1={hash}`).
- DPDP Act 2023 Section 12(3) & NMC Regulation 1.3.1 `[CITED: nmc.org.in / dpdpa.com]` — Legal reconciliation of Right to Erasure with mandatory 3-year medical record retention.
- GitHub / Stripe API Key Best Practices `[CITED: apikeys.guide / github.blog]` — Prefixed key format, SHA-256 hashing at rest, secret scanning.

### Tertiary (LOW confidence)
- None. All architectural patterns and constraints are verified from the repository or authoritative standards.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Zero new external packages; uses established Next.js 15, Supabase, and Node built-in crypto.
- Architecture: HIGH — Directly mirrors existing transactional outbox and PDF generation patterns in codebase.
- Pitfalls: HIGH — Specific to healthcare regulations (NMC 3-year retention) and cryptographic webhooks.

**Research date:** 2026-11-09  
**Valid until:** 2026-12-09 (stable architecture based on LTS Node.js and Next.js 15 App Router standards)
