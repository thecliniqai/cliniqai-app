# ClinicQ

## What This Is

A single-plan, cloud-based clinic management platform for solo and small outpatient clinics in India, covering the full patient journey — booking, records, prescriptions, diagnosis, labs, referrals, reminders — in one modern, mobile-first product. Priced at a flat ₹1,000/month per clinic with all features included, API access, and AI assistance built in from the start.

## Core Value

Every core clinic action (book, prescribe, record a visit) is obviously, overwhelmingly faster than the paper/WhatsApp status quo — zero-training, under 3 taps, usable entirely from a phone.

## Business Context

- **Customer**: Solo/small clinic owner (doctor) in India — primary buyer; receptionist/nurse/patient are daily users
- **Revenue model**: Flat ₹1,000/month per clinic, one plan, no feature gating
- **Success metric**: Median time to complete a visit record under 3 minutes (PRD §8); supporting: 50 paying clinics within 3 months of go-live, <5% monthly churn, >95% WhatsApp/SMS delivery success
- **Strategy notes**: `docs/clinic-management-prd.md` (source PRD)

## Requirements

### Validated

(None yet — ship to validate)

### Active

Full definitions with acceptance criteria: `.planning/REQUIREMENTS.md`

- [ ] **REQ-multi-tenancy**: Isolated clinic tenants, staff roles (Owner/Admin, Doctor, Receptionist, Nurse), OTP staff invites, subscription visibility
- [ ] **REQ-appointment-booking**: Per-doctor calendar, configurable slots/hours/breaks, walk-in queue, full appointment states, waitlist, double-booking prevention
- [ ] **REQ-patient-records**: Unified patient profile, deduplication, search, visit-history timeline, attachments, consent capture
- [ ] **REQ-specialty-templates**: Generic core visit record + configuration-driven specialty templates (GP, Dental, Gynae, Peds, Derm, Ortho)
- [ ] **REQ-diagnosis-visit-management**: ICD-10 diagnosis coding, visit types, queue-aligned workflow states, AI-assisted note requiring doctor confirmation
- [ ] **REQ-e-prescriptions**: India drug search, per-doctor templates, safety warnings, branded PDF, auditable history
- [ ] **REQ-lab-records**: Lab orders from visits, in-house/external routing, structured results with abnormal flagging, patient-facing secure link
- [ ] **REQ-reminders-notifications**: SMS/WhatsApp reminders across lifecycles, two-way WhatsApp reply handling, full communication audit log
- [ ] **REQ-referrals**: In-network (consented history share) and out-of-network (PDF letter) referrals with tracking and closing-the-loop notes
- [ ] **REQ-billing-invoicing** ⚠️ **PROVISIONAL**: Per-visit billing, payment recording (no gateway), PDF receipts, collection reports — source-flagged open question (PRD §9.1), confirm scope before build
- [ ] **REQ-ai-features**: Assistive visit/history summarization, scheduling assist, prescription suggestion from doctor's own history — all AI-labeled until clinician acceptance
- [ ] **REQ-api-access**: API-first REST API over core entities, tenant-scoped keys, webhooks, per-tenant rate limiting/usage logs
- [ ] **REQ-compliance-data-layer**: ABDM/ABHA/FHIR-ready data structures designed now (nullable ABHA, ICD coding, structured clinical docs, immutable consent records) — no live integration
- [ ] **REQ-nfr-multi-tenancy-scalability**: DB-level tenant isolation (RLS), scales to thousands of tenants, stateless app layer
- [ ] **REQ-nfr-performance**: Core actions in 1–2s on Indian mobile networks; offline-tolerant UX where feasible
- [ ] **REQ-nfr-security**: Encryption in rest/transit, RBAC at API + UI, patient-record audit logging, OTP auth, tested backups
- [ ] **REQ-nfr-regulatory-compliance**: DPDP Act consent/access/delete, clinic license storage, teleconsultation + live ABDM deferred
- [ ] **REQ-nfr-reliability**: 99.5%+ uptime target; messaging-provider outage must not affect in-app clinical workflows

### Out of Scope

- AI Voice Agent / receptionist product — separate PRD; consumes this platform's API
- In-patient / hospital ward management — outpatient clinic product
- Insurance/TPA claims + NHCX integration — future integration point
- Live ABDM/ABHA/UHI integration — data-layer readiness only (REQ-compliance-data-layer)
- Native mobile apps — responsive web first
- Multi-language / regional UI — English-only unless specified
- Teleconsultation (Telemedicine Practice Guidelines) — future consideration
- Payment gateway for per-visit billing — recording only (cash/UPI/card) initially

## Context

- **Repo state**: Documentation-only brownfield — no application source tree yet (`.planning/codebase/` map, docs-only repo, 0 commits). First scaffold starts clean per AGENTS.md §6.2/§22 structure.
- **Source of truth**: `docs/clinic-management-prd.md` (PRD v1.0, confidence: high); ingest summary at `.planning/intel/SYNTHESIS.md`, conflict report at `.planning/INGEST-CONFLICTS.md` (0 blockers).
- **UI authority**: `DESIGN.md` — light theme only, canonical design system.
- **Engineering authority**: `AGENTS.md` — architecture, security, testing, delivery rules.
- **Key product principles**: zero-training UI, mobile-first (Tier 2/3 city clinics on phones), one record everywhere, compliance-ready by construction, AI as assistant never record of truth, no feature gating.

## Constraints

- **Tech stack**: Next.js App Router + Supabase (Postgres/Auth/RLS/Storage) + Vercel — PRD §6 and AGENTS.md §5; avoid deep Supabase coupling where standard Postgres + REST would work; abstract file storage behind an interface — why: future migration path to dedicated cloud.
- **Design**: Light theme only, `DESIGN.md` is the single UI authority — no dark mode, no second design system.
- **Timeline**: Solo founder targeting ~3 months to go-live (PRD §6) — favors boring architecture and vertical slices.
- **Communications**: WhatsApp/SMS providers must be pluggable (BSP/gateway choice open; Meta approval takes 1–2 weeks — PRD §9.4).
- **Compliance**: Sensitive patient data — DPDP-conscious by construction; ABDM/FHIR-shaped data structures from day one; no compliance claims without review.
- **Pricing**: Single plan, no feature gating — differentiation is quality, not access.

## Key Decisions

No ADR-locked decisions from this ingest (0 ADR classifications; see `.planning/intel/decisions.md`).

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Stack: Next.js + Supabase + Vercel (PRD §6 starting point) | Solo-founder speed, low infra cost, RLS gives DB-level tenancy | — Pending (not ADR-locked; revisit if scale/compliance demands dedicated cloud) |
| Billing module included as PROVISIONAL scope | Source flagged §4.10/§9.1 as unconfirmed assumption — kept in roadmap, explicitly marked | ⚠️ Revisit — confirm with owner before Phase 3 build |

---
*Last updated: 2026-10-06 after initial doc ingest (gsd-roadmapper)*
