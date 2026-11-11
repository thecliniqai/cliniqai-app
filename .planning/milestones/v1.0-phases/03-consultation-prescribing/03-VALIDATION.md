---
phase: "03"
slug: "consultation-prescribing"
status: draft
nyquist_compliant: true
wave_0_complete: false
created: "2026-10-11"
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm run test` |
| **Full suite command** | `npm run typecheck && npm run test` |
| **Estimated runtime** | ~10-15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test` or targeted test suite
- **After every plan wave:** Run `npm run typecheck && npm run test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | REQ-e-prescriptions | T-03-01 | CDCI search indexes and RLS policies prevent cross-tenant data leakage | integration | `npx vitest run tests/integration/cdci-search.spec.ts` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | REQ-diagnosis-visit-management | T-03-02 | Terminology dataset search respects tenant isolation and returns sub-100ms | integration | `npx vitest run tests/integration/cdci-search.spec.ts` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 2 | REQ-specialty-templates | T-03-03 | Consultation schemas validate input bounds and prevent prototype pollution | unit | `npx vitest run tests/consultation/schemas.spec.ts` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 2 | REQ-specialty-templates | T-03-04 | Dental Odontogram correctly validates FDI tooth numbers and tag serializations | unit | `npx vitest run tests/dental/odontogram.spec.ts` | ❌ W0 | ⬜ pending |
| 03-02-03 | 02 | 2 | REQ-specialty-templates | T-03-05 | WHO LMS Z-score algorithm accurately computes percentiles for pediatric growth | unit | `npx vitest run tests/pediatrics/who-growth.spec.ts` | ❌ W0 | ⬜ pending |
| 03-03-01 | 03 | 3 | REQ-e-prescriptions | T-03-06 | Dosage chips parser securely normalizes Indian OPD frequencies and durations | unit | `npx vitest run tests/prescriptions/dosage.spec.ts` | ❌ W0 | ⬜ pending |
| 03-03-02 | 03 | 3 | REQ-diagnosis-visit-management | T-03-07 | Visit progression and post-completion edits preserve immutable audit trail | integration | `npx vitest run tests/integration/consultation-flow.spec.ts` | ❌ W0 | ⬜ pending |
| 03-04-01 | 04 | 4 | REQ-e-prescriptions | T-03-08 | PDF generation signed URLs enforce tenant authorization and prevent URL tampering | integration | `npx vitest run tests/integration/prescription-versioning.spec.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/prescriptions/dosage.spec.ts` — Dosage chips and frequency parsing stubs
- [ ] `tests/pediatrics/who-growth.spec.ts` — WHO growth LMS calculation tests
- [ ] `tests/dental/odontogram.spec.ts` — Dental FDI tooth numbering and tag serialization tests
- [ ] `tests/consultation/schemas.spec.ts` — Consultation and specialty Zod schema tests
- [ ] `tests/integration/cdci-search.spec.ts` — CDCI search and doctor custom medicines tests
- [ ] `tests/integration/consultation-flow.spec.ts` — Consultation visit lifecycle and status progression tests
- [ ] `tests/integration/prescription-versioning.spec.ts` — Prescription revisions and PDF generation tests

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Physical print margin alignment on pre-printed clinic stationery | REQ-e-prescriptions | Requires physical printer and pre-printed letterhead pad paper | Print PDF with 'Pre-Printed Letterhead' mode selected and align against physical letterhead pad margins (110pt top, 60pt bottom) |
| Odontogram interactive SVG click responsiveness on mobile | REQ-specialty-templates | Touch interactions on small screens | Open dental consultation on mobile device, tap teeth in visual odontogram, and verify condition popup touch responsiveness |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-10-11
