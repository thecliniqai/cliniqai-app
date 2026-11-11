# Phase 4: Labs & Referrals - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-22
**Phase:** 04-Labs & Referrals
**Areas discussed:** Lab Catalog & Order Placement, Result Entry & Abnormal Flagging, Patient Result Access & Storage, Referrals & Loop-Closure Tracking

---

## Lab Catalog & Order Placement

| Option | Description | Selected |
|--------|-------------|----------|
| Pre-seed standard catalog | Pre-seed curated catalog of ~40 common Indian OPD tests (CBC, LFT, KFT, etc.) | |
| Blank catalog | Start with blank catalog where clinics create tests and pricing in Settings | |
| You decide | Zero setup friction | |
| **User Direct Input** | **No separate heavy lab module needed. Tests are recommended directly in Consultation, and returned reports uploaded to patient profile.** | **✓** |

**User's choice:** Recommend lab tests inside Consultation; upload returned reports to patient profile without in-house lab catalog overhead.
**Notes:** Most solo/small Indian clinics do not operate an in-house laboratory. Having test catalogs, technician queues, and parameter-by-parameter numeric entry represents unnecessary friction.

---

## Result Entry & Abnormal Flagging

| Option | Description | Selected |
|--------|-------------|----------|
| Link to both Visit and Profile | Allow uploading from Profile and Visit History, linking to visit | |
| Dedicated Lab Reports section on Profile | Dedicated tab/card on `/patients/[id]`, decoupled from visit bottleneck | **✓** |
| You decide | Mobile/desktop upload with minimal clicks | |

**User's choice:** Dedicated section in Patient Profile (`/patients/[id]`) with optional visit linking, avoiding strict foreign-key visit bottlenecks.

| Option | Description | Selected |
|--------|-------------|----------|
| Fast 3-field capture | Report name/tests, date, and abnormal flag toggle with short note | |
| Ultra-minimal | Just PDF file upload and title | |
| You decide | Balance mobile upload speed with searchability | |
| **User Direct Input** | **Upload file with auto-amended filename (patient name + date); AI analysis deferred to Phase 5.** | **✓** |

**User's choice:** Upload file directly without manual parameter entry; system automatically standardizes and amends the file name with patient name and date. Detailed extraction is deferred to Phase 5 AI Assist.

---

## Patient Result Access & Storage

| Option | Description | Selected |
|--------|-------------|----------|
| Abstracted storage adapter | Supabase Storage now with private signed URLs & tokenized patient links, ready to swap to Cloudflare R2 | **✓** |
| Cloudflare R2 now | Implement Cloudflare R2 immediately in Phase 4 | |
| Internal clinic access only | Only logged-in clinic staff view/download; patient sharing deferred to Phase 5 | |

**User's choice:** Option 1 (Abstracted storage adapter supporting Prescriptions, Invoices, and Lab Reports, ready for Cloudflare R2).
**Notes:** User specifically instructed that the Cloudflare R2-ready storage abstraction must be designed to cover Prescriptions and Invoices as well, allowing all clinic PDFs to easily switch to Cloudflare R2 via environment variables later.

---

## Referrals & Loop-Closure Tracking

| Option | Description | Selected |
|--------|-------------|----------|
| Dual entry | Create referrals during active Consultation visit and from Patient Profile (`/patients/[id]`) | **✓** |
| Only Consultation | Referrals must originate from active doctor encounter | |
| Standalone page only | Referrals initiated only from a dedicated manager | |

**User's choice:** Dual entry (both Consultation Cabin and Patient Profile).

| Option | Description | Selected |
|--------|-------------|----------|
| Formal branded PDF referral letter | Automatically pre-fills clinic letterhead, patient summary, diagnosis, medications, referral notes, signature | **✓** |
| Simple digital note & print | Lightweight note with quick print button | |
| You decide | Mirror prescription PDF layout with letterhead margins | |

**User's choice:** Formal branded PDF referral letter using `@react-pdf/renderer`.

| Option | Description | Selected |
|--------|-------------|----------|
| Consent-gated digital sharing | Consent checkbox on referral form granting in-network doctor read access to recent visit summaries & meds | **✓** |
| Safe PDF exchange | In-network referral sends referral letter PDF without cross-tenant database sharing | |
| You decide | Strict multi-tenant boundary with audit-logged consent | |

**User's choice:** Consent-gated digital sharing with explicit consent checkbox.

| Option | Description | Selected |
|--------|-------------|----------|
| Centralized Referrals Register (`/referrals`) | Outbound/Inbound tabs, status badges (Sent, Acknowledged, Completed), and 1-tap "Close the Loop" modal | **✓** |
| Profile-only tracking | Track exclusively inside `/patients/[id]` timeline without `/referrals` nav item | |
| You decide | Balance receptionist tracking with simple navigation | |

**User's choice:** Centralized Referrals Register (`/referrals`) with Outbound/Inbound tabs, status badges, and 1-tap "Close the Loop" notes modal.

---

## the agent's Discretion

- Standardized private bucket folder paths (`tenants/[tenant_id]/patients/[patient_id]/labs/...`).
- Database schema and indexing for `patient_documents` / `lab_records` and `referrals`.
- Tokenized public preview URL expiration window and token table design.
- UI component design conforming strictly to `DESIGN.md` light theme tokens.

---

## Deferred Ideas

- **Automated AI Lab Report Analysis:** Extraction of numerical biomarkers and abnormal range checking via LLM/OCR (Phase 5).
- **Cloudflare R2 Bucket Migration:** Physical transfer of legacy Supabase bucket files to Cloudflare R2 (future ops task).
- **WhatsApp/SMS Dispatch:** Automated messaging of report/referral links to patients (Phase 5).
