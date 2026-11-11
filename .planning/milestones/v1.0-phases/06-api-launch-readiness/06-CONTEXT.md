# Phase 06: API & Launch Readiness - Context

**Gathered:** 2026-11-09  
**Status:** Ready for planning  

<domain>
## Phase Boundary

Phase 06 delivers external programmability, developer integrations, and launch-grade non-functional requirements (NFRs) across reliability, performance, security, and regulatory compliance for ClinicQ:

1. **External Developer REST API (`/api/v1/*`):**
   - Tenant-scoped API key authentication via Bearer token (`clq_live_...`), hashed with SHA-256 and stored in the database with prefix hints.
   - Comprehensive CRUD endpoints over core clinical and administrative entities: Patients, Appointments, Visits, Prescriptions, Lab Orders, and Referrals.
   - Strict tenant isolation enforced at the database layer via Supabase RLS and server-derived tenant ID.
   - Standardized versioned namespace with uniform JSON response envelopes (`{ data, meta }` on success, `{ error: { code, message, details } }` on failure).
   - Auto-generated OpenAPI 3.0 specification (`/api/v1/openapi.json`) with an interactive documentation viewer.
   - Standard page/limit pagination, query filtering, and clinical doctor validation on mutations.

2. **Webhook Event Engine & Delivery Resilience:**
   - Outgoing webhook event notifications for core clinic lifecycle triggers: `appointment.booked`, `appointment.cancelled`, `appointment.rescheduled`, `visit.completed`, `lab_result.ready`, and `prescription.issued`.
   - Transactional Outbox Queue (`webhook_delivery_queue` table) with non-blocking initial dispatch and exponential backoff retry via cron.
   - Payload authenticity secured with HMAC-SHA256 signature and timestamp (`X-ClinicQ-Signature: t=...,v1=...`) using per-subscription signing secrets (`whsec_...`).
   - Webhook management and delivery log drawer embedded in Clinic Profile Settings.

3. **DPDP Act Patient Rights & Data Lifecycle:**
   - Right to Access / Portability: Dual-format export providing both a machine-readable JSON archive and a human-readable consolidated medical summary PDF from the patient record.
   - Right to Erasure / Medical Retention: Soft-delete workflow flagging patients as `erased`, hiding them from search and active workflows while preserving clinical records under restricted compliance access to satisfy NMC mandatory 3-year statutory medical record retention obligations.
   - Single global consent toggle ("Active Consent" vs "Withdrawn Consent") on the patient record with timestamped audit logging.
   - Structured, optional statutory fields in Clinic Settings: Clinical Establishment Act Reg No., State Medical Council Reg No., GSTIN, and Drug License No.

4. **Launch Readiness, Health & Security Hardening:**
   - Permanent decommissioning/lockout of dev-only auth logger (`lib/auth/dev-logger.ts`), ensuring OTPs and invite links are never written to disk or logged to console in production.
   - Health and readiness probe endpoints (`/api/health`, `/api/ready`) monitoring database, storage, and background queue health.
   - Rate limiting across `/api/v1/*` endpoints (default 120 req/min per key) with standard rate-limit headers.

</domain>

<decisions>
## Implementation Decisions

### 1. REST API & Developer Key Management
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

### 2. Webhook Event Engine & Delivery Resilience
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

### 3. DPDP Act Patient Rights & Data Lifecycle
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

### 4. Launch Readiness, Health & Security Hardening
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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product & Requirements
- `docs/clinic-management-prd.md` §4.12 (API Access & Webhooks), §5.1 (Multi-Tenancy & Scalability), §5.2 (Performance), §5.3 (Security), §5.4 (Regulatory Compliance & DPDP Act), §5.5 (Reliability & Uptime).
- `.planning/REQUIREMENTS.md` (`REQ-api-access`, `REQ-nfr-performance`, `REQ-nfr-reliability`, `REQ-nfr-regulatory-compliance`).
- `.planning/phases/06-api-launch-readiness/06-DISCUSS-CHECKPOINT.json` — Decision log and options audit.

### Engineering & Architecture
- `AGENTS.md` §5 (Technology Stack — Next.js, Supabase, Tailwind, Radix), §7 (Multi-Tenancy & Tenant Isolation), §8 (Identity, Auth & RBAC), §9 (Healthcare / Sensitive Data Handling), §10 (Auditability), §11 (API Standards), §12 (Error Handling), §14 (Database Rules).
- `DESIGN.md` — Canonical UI design system: light-only theme, `#1769E0` primary brand palette, TailAdmin tokens, table and drawer primitives.

### Existing System Implementations
- `lib/auth/dev-logger.ts` — Dev auth logger to audit and permanently decommission for production.
- `lib/messaging/` — Reference transactional outbox queue pattern (`communication_queue`) with cron recovery.
- `lib/supabase/` — Supabase server and service-role database clients.
- `lib/pdf/` — Server-side `@react-pdf/renderer` pipeline for document generation.
- `features/settings/` & `app/(dashboard)/settings/clinic/` — Settings page tab mounting points.
- `features/patients/` & `app/(dashboard)/patients/[id]/` — Patient profile for DPDP export and consent toggle.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/supabase/server.ts` & `lib/supabase/admin.ts`: Database client creation with cookie or service-role privileges.
- `lib/messaging/` outbox runner: Existing pattern for asynchronous queued dispatch with retry backoff.
- `components/ui/`: Radix-based modal (`dialog.tsx`), drawer (`sheet.tsx`), badge, button, and table components matching `DESIGN.md`.
- `features/patients/services.ts`: Existing patient queries and mutations with E.164 phone normalization.
- `features/appointments/services.ts`: Appointment scheduling and status transition logic.
- `features/consultation/services.ts`: Clinical consultation records and visit state management.

### Established Patterns
- Database-level tenant isolation with Supabase RLS (`tenant_id = ...`).
- Standard audit logging in `public.audit_logs`.
- Light-only UI with clean borders, high contrast, and responsive desktop/mobile layouts.
- Transactional mutations wrapping multi-table state updates.

### Integration Points
- **External API Routes (`app/api/v1/`):** New route hierarchy for patients, appointments, visits, prescriptions, lab orders, and referrals.
- **Webhook Dispatch Cron (`app/api/cron/webhooks/`):** Cron endpoint processing pending and failed webhook deliveries.
- **Health Probes (`app/api/health/route.ts` & `app/api/ready/route.ts`):** Unauthenticated monitoring endpoints.
- **Clinic Settings Tab (`app/(dashboard)/settings/clinic/`):** Dedicated tab for API keys and webhook configuration.
- **Patient Detail Page (`app/(dashboard)/patients/[id]/`):** UI triggers for DPDP export (JSON/PDF) and global consent toggle.

</code_context>

<specifics>
## Specific Ideas

- **Single-Reveal API Keys:** Like Stripe and GitHub, reveal the raw API key secret once upon generation with a distinct copy button and visual warning that it cannot be retrieved again.
- **Non-Mandatory Statutory Fields:** Allow clinics to onboard easily without requiring immediate entry of clinical establishment or drug license numbers, but dynamically show them on letterheads and prescription PDFs when filled.
- **Zero-Production Leaks:** Permanently disable `lib/auth/dev-logger.ts` in production builds to ensure OTPs and invite tokens cannot appear in hosted logs.

</specifics>

<deferred>
## Deferred Ideas

- **Granular OAuth2 Scopes:** Scopes like `patients:read` vs `patients:write` deferred in favor of full clinic admin keys for v1.
- **Inbound Patient Webhooks:** Inbound webhook subscriptions for external EHR sync deferred to post-launch integrations.
- **Live ABDM Integration:** Live ABDM/M1/M2/M3 gateway integration remains deferred per `REQ-compliance-data-layer` (data models are schema-ready).

</deferred>

---

*Phase: 06-api-launch-readiness*  
*Context gathered: 2026-11-09*
