# Phase 06: API & Launch Readiness - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-09  
**Phase:** 06-api-launch-readiness  
**Areas discussed:** REST API & Developer Key Management, Webhook Event Engine & Delivery Resilience, DPDP Act Patient Rights & Data Lifecycle  

---

## REST API & Developer Key Management

### Question 1: Key Format & Storage Security
| Option | Description | Selected |
|--------|-------------|----------|
| Prefixed Bearer tokens (clq_live_...) | Secret displayed ONCE at generation, stored as SHA-256 hash with prefix hint in DB | |
| Reversible encrypted keys (AES-GCM) | Clinic admins can re-view full API keys anytime in settings | |
| You decide (follow modern SaaS standards) | Modern standard: prefixed Bearer token, hash in DB, reveal once, revocable | ✓ |

**User's choice:** You decide (follow modern SaaS API key security standards)  
**Notes:** Stored as SHA-256 hash (`key_hash`) with prefix hint (`clq_live_xxxx...`), human-readable label, last-used timestamp, and revocation capability.

### Question 2: Permission Scopes
| Option | Description | Selected |
|--------|-------------|----------|
| Granular entity permissions | Pre-grouped or bounded by in-app clinic roles (e.g. patients:read/write) | |
| Direct in-app role assignment | Inherits exact server-side role permissions (Owner, Doctor, Receptionist) | |
| All-or-nothing clinic admin keys | Full tenant access for all supported entities | ✓ |

**User's choice:** All-or-nothing clinic admin keys (full tenant access for all supported entities)  
**Notes:** Simple and frictionless for small/mid clinics; data strictly isolated to the tenant via Supabase RLS.

### Question 3: Route Namespace & Response Envelopes
| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated /api/v1/* namespace | Standardized envelopes: { data, meta } for success, { error } for failures | ✓ |
| Unversioned /api/* | Share route handlers with internal Next.js frontend calls | |
| You decide | Standard REST conventions | |

**User's choice:** Dedicated versioned namespace /api/v1/* with standardized JSON envelopes  
**Notes:** Clear separation between external integrations and internal Next.js server actions / routes.

### Question 4: Key Management UI Location
| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated Settings tab at /settings/developer | Listing active keys, last used, generate modal, revoke action | |
| Expandable card in /settings/clinic | In existing clinic settings page | |
| You decide | Standard location | |
| Clinic Profile dedicated tab | Inside Clinic Profile (dedicated tab for API Key) at /settings/clinic | ✓ |

**User's choice:** Inside Clinic Profile (dedicated tab for API Key) at /settings/clinic  
**Notes:** Integrated into existing clinic management navigation under `/settings/clinic`.

### Question 5: Clinician Assignment in API Mutations
| Option | Description | Selected |
|--------|-------------|----------|
| Require explicit doctor_id | Validated against clinic's active doctor staff for clinical records | ✓ |
| Default to clinic owner/primary doctor | If doctor_id is omitted in the API payload | |
| You decide | Builder discretion | |

**User's choice:** Require explicit doctor_id (validated against clinic's active doctor staff) for clinical records (visits, prescriptions)  
**Notes:** Enforces clinical accountability and accurate doctor attribution for legal medical records.

### Question 6: Pagination and Query Filtering
| Option | Description | Selected |
|--------|-------------|----------|
| Standard page/limit pagination | Default 20, max 100 with query params (search, phone, status, start_date, end_date) | ✓ |
| Cursor-based pagination | Using created_at or ID with query filters | |
| You decide | Standard REST conventions | |

**User's choice:** Standard page/limit pagination (default 20, max 100) with query params (search, phone, status, start_date, end_date)  
**Notes:** Predictable, easy-to-integrate client experience.

### Question 7: API Documentation & OpenAPI Specification
| Option | Description | Selected |
|--------|-------------|----------|
| Auto-generated OpenAPI 3.0 spec | /api/v1/openapi.json with an embedded interactive docs viewer for developers | ✓ |
| Static developer guide | Code samples embedded in Clinic Settings tab | |
| You decide | Standard documentation format | |

**User's choice:** Auto-generated OpenAPI 3.0 spec (/api/v1/openapi.json) with an embedded interactive docs viewer for developers  
**Notes:** Enables automated client SDK generation and interactive testing.

### Question 8: Request Auditing and Logging
| Option | Description | Selected |
|--------|-------------|----------|
| Log mutations to audit_logs | POST/PUT/DELETE logged with actor_type: api_key; aggregate daily counters for rate/usage | ✓ |
| Log every single HTTP request | Write all requests (including GETs) to dedicated api_request_logs table | |
| You decide | Efficient audit pattern | |

**User's choice:** Log mutations (POST/PUT/DELETE) to audit_logs (actor_type: api_key), and record daily request counts for rate/usage tracking  
**Notes:** Keeps database lean while maintaining strict auditability of all state modifications.

---

## Webhook Event Engine & Delivery Resilience

### Question 1: Domain Event Trigger Catalog
| Option | Description | Selected |
|--------|-------------|----------|
| Comprehensive clinic event catalog | appointment.booked, appointment.cancelled, appointment.rescheduled, visit.completed, lab_result.ready, prescription.issued | ✓ |
| Minimal strict set | Only appointment.booked, appointment.cancelled, visit.completed, lab_result.ready | |
| You decide | Standard event coverage | |

**User's choice:** Comprehensive clinic event catalog: appointment.booked, appointment.cancelled, appointment.rescheduled, visit.completed, lab_result.ready, prescription.issued  
**Notes:** Provides complete lifecycle hooks for external pharmacy, lab, and CRM bridges.

### Question 2: Queuing and Dispatch Architecture
| Option | Description | Selected |
|--------|-------------|----------|
| Transactional Outbox Queue | Asynchronous, immediate first attempt + exponential backoff retry via cron, non-blocking | ✓ |
| Direct synchronous HTTP dispatch | Immediate, but blocks request if subscriber is slow or down | |
| You decide | System resilience pattern | |

**User's choice:** Transactional Outbox Queue (asynchronous, immediate first attempt + exponential backoff retry via cron, non-blocking)  
**Notes:** Protects core app latency and ensures webhook deliveries survive transient subscriber downtime.

### Question 3: Signature and Authenticity
| Option | Description | Selected |
|--------|-------------|----------|
| HMAC-SHA256 signature with timestamp | X-ClinicQ-Signature: t=...,v1=... using a per-webhook signing secret (whsec_...) | |
| Static shared secret header token | X-Webhook-Secret: ... without timestamp hashing | |
| You decide | Modern industry standard webhook security | ✓ |

**User's choice:** You decide (industry standard webhook security)  
**Notes:** Uses Stripe/Svix standard HMAC-SHA256 timestamp signature (`X-ClinicQ-Signature: t={timestamp},v1={hex}`) with per-subscription secret (`whsec_...`).

### Question 4: Webhook Settings UI Location
| Option | Description | Selected |
|--------|-------------|----------|
| In Clinic Profile alongside API Keys | /settings/clinic tab with endpoint list, signing secret, and delivery logs drawer | ✓ |
| Separate top-level developer section | /settings/webhooks | |
| You decide | UI placement discretion | |

**User's choice:** In Clinic Profile alongside API Keys (/settings/clinic tab), with endpoint list, signing secret, and delivery logs drawer  
**Notes:** Consolidates all developer integrations into one intuitive tab.

---

## DPDP Act Patient Rights & Data Lifecycle

### Question 1: Right to Access / Export Format
| Option | Description | Selected |
|--------|-------------|----------|
| Dual format: JSON + PDF | Machine-readable structured JSON export AND human-readable comprehensive medical summary PDF | ✓ |
| Human-readable PDF summary only | Demographics, visits, prescriptions, vitals | |
| Machine-readable JSON only | Data archive only | |

**User's choice:** Dual format: Machine-readable structured JSON export AND human-readable comprehensive medical summary PDF  
**Notes:** Satisfies technical data portability while giving patients an easily readable medical history document.

### Question 2: Right to Erasure vs Medical Record Retention
| Option | Description | Selected |
|--------|-------------|----------|
| Medical-Compliant PII Anonymization | Wipe personal PII while retaining de-identified clinical records for NMC retention | |
| Soft delete | Hide patient from search and active views, flag status as 'erased', preserve records with restricted admin access | ✓ |
| Hard delete | Cascade delete all patient data, visits, and documents from database | |

**User's choice:** Soft delete (hide patient from search and active views, flag status as 'erased', preserve records with restricted admin access)  
**Notes:** Reconciles DPDP erasure with mandatory 3-year statutory medical record retention under NMC RMP Regulations 2023.

### Question 3: Consent Tracking & Withdrawal
| Option | Description | Selected |
|--------|-------------|----------|
| Granular consent toggles | Separate toggles for Comms, Referrals, AI with audit trail | |
| Single global toggle | Active Consent vs Withdrawn Consent on the patient record | ✓ |
| You decide | Consent UI discretion | |

**User's choice:** Single global toggle (Active Consent vs Withdrawn Consent) on the patient record  
**Notes:** Clean, simple UX for clinic staff with full timestamped audit logging on change.

### Question 4: Clinic Statutory Registration Fields
| Option | Description | Selected |
|--------|-------------|----------|
| Structured statutory fields (mandatory) | Reg No., State Medical Council No., GSTIN, Drug License No. | |
| Single freeform text field | Clinic License / Reg No. in Clinic Profile | |
| Structured statutory fields (optional) | Structured fields in /settings/clinic but non-mandatory, rendered on PDFs when present | ✓ |

**User's choice:** Structured statutory fields in /settings/clinic: Clinical Establishment Act Reg No., State Medical Council Reg No., GSTIN, and Drug License No. (non-mandatory, rendered on headers/PDFs when present)  
**Notes:** Non-blocking onboarding while supporting full statutory compliance and professional letterhead rendering.

---

## the agent's Discretion

- Bearer token format (`clq_live_...`) with SHA-256 hash storage.
- HMAC-SHA256 webhook signature header format (`X-ClinicQ-Signature: t=...,v1=...`).
- Rate limiting middleware using in-memory / Postgres leaky bucket (default 120 req/min per key) with HTTP 429 response.
- Health probes `/api/health` and `/api/ready` evaluating database, storage, and outbox queue status.
- Dev-only auth logger (`lib/auth/dev-logger.ts`) complete decommissioning in production mode.

## Deferred Ideas

- Granular OAuth2 permission scopes (`patients:read`, `appointments:write`) deferred in favor of full clinic admin keys.
- Inbound patient webhook subscriptions for third-party EHR bi-directional synchronization.
- Live ABDM/M1/M2/M3 network integration deferred per `REQ-compliance-data-layer`.
