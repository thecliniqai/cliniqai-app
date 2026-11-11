---
phase: "1"
slug: "foundation-tenant-isolation"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-06"
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (unit/integration) + Playwright (E2E for critical journeys) [ASSUMED] |
| **Config file** | `vitest.config.ts`, `playwright.config.ts` (to be created in Wave 0) |
| **Quick run command** | `npm run test -- --run --reporter=basic` |
| **Full suite command** | `npm run test && npm run lint && npm run typecheck` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -- --run --reporter=basic`
- **After every plan wave:** Run `npm run test && npm run lint && npm run typecheck`
- **Before `/gsd-verify-work`:** Full suite must be green + cross-tenant tests passing
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | REQ-multi-tenancy | T-1-01 / — | Tenant isolation enforced (no cross-tenant data visible) | integration | `npx vitest run tests/integration/multi-tenancy.spec.ts` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 1 | REQ-multi-tenancy | T-1-02 / — | RBAC server-side enforcement for roles | unit/integration | `npx vitest run tests/auth/rbac.spec.ts` | ❌ W0 | ⬜ pending |
| 1-01-03 | 01 | 1 | REQ-multi-tenancy | T-1-03 / — | Staff invite + OTP onboarding flow | integration | `npx vitest run tests/auth/invite.spec.ts` | ❌ W0 | ⬜ pending |
| 1-01-04 | 01 | 1 | REQ-compliance-data-layer | — | Patient has nullable ABHA field | unit | `npx vitest run tests/patients/schema.spec.ts` | ❌ W0 | ⬜ pending |
| 1-01-05 | 01 | 1 | REQ-compliance-data-layer | T-1-04 / — | Consent records immutable (no update/delete of original) | integration | `npx vitest run tests/compliance/consent.spec.ts` | ❌ W0 | ⬜ pending |
| 1-01-06 | 01 | 1 | REQ-nfr-security | T-1-05 / — | Audit log written on patient view/edit | integration | `npx vitest run tests/audit/audit-logging.spec.ts` | ❌ W0 | ⬜ pending |
| 1-01-07 | 01 | 1 | REQ-nfr-security | T-1-06 / — | Cross-tenant access blocked by RLS | integration | `npx vitest run tests/security/cross-tenant.spec.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` — test setup (framework install)
- [ ] `tests/integration/multi-tenancy.spec.ts` — stubs for REQ-multi-tenancy isolation
- [ ] `tests/security/cross-tenant.spec.ts` — explicit cross-tenant RLS tests
- [ ] `tests/auth/rbac.spec.ts` — RBAC server-side enforcement
- [ ] `tests/auth/invite.spec.ts` — invite + OTP flow
- [ ] `tests/audit/audit-logging.spec.ts` — audit on patient view/edit
- [ ] `tests/compliance/consent.spec.ts` — consent immutability
- [ ] `tests/patients/schema.spec.ts` — ABHA nullable field
- [ ] `playwright.config.ts` + basic E2E smoke (optional for Phase 1)

*Tests must validate RLS behaviour with test tenants.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual layout of clinic setup / staff invite screens vs `DESIGN.md` | REQ-nfr-multi-tenancy-scalability | Visual/UX judgement cannot be asserted deterministically without screenshot baselines | Walk the clinic-setup and invite screens at mobile + desktop breakpoints; confirm token usage, focus states, and status-not-color-only |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
