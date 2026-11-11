# Milestones

## v1.0 MVP (Shipped: 2026-11-11, override closeout)

**Phases completed:** 13 phases (1, 2, 02.1, 3, 03.1, 03.2, 03.3, 4, 5, 05.1, 05.2, 05.3, 6), 49 plans
**Git:** baseline tag `v1.0-mvp-baseline` on `main`; archived on branch `v2/phase-01a-local-db-harness` (2026-11-11)
**Archive:** `milestones/v1.0-ROADMAP.md`, `milestones/v1.0-REQUIREMENTS.md`, `milestones/v1.0-phases/`

**Key accomplishments:**
- Multi-tenant foundation on Supabase with RLS, staff roles, audit logging and compliance-ready schemas
- Patient records, per-doctor scheduling, walk-in queue and doctor availability/shifts
- Consultation workflow with specialty templates, ICD-10 coding, e-prescriptions and per-visit billing
- Labs and referrals; MSG91 SMS/WhatsApp messaging with delivery webhooks
- REST API with prefixed bearer keys, rate limiting and a signed webhook outbox

**Closeout type:** override_closeout (PO ruling, 2026-11-11)

### Known Gaps
- Verification: only phase 6 has a passing VERIFICATION.md; phases 1, 2, 02.1, 03.2 and 05.3 have none, and
  3, 03.1, 03.3, 4, 5, 05.1 and 05.2 are stale.
- Requirements: 0 of 18 v1 requirements were checked off in REQUIREMENTS.md.
- The authoritative assessment of v1 is `docs/v2/VERIFICATION_LOG.md` and `docs/v2/V2_MASTER_ROADMAP.md`
  (P0 security defects SEC-01/SEC-02 and others). v1 is superseded by milestone v2.0; it is not a release
  baseline for production.

Known verification overrides: 12 newly acknowledged (phases above), 0 carried forward.

---
