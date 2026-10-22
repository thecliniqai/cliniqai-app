---
phase: "4"
slug: "labs-referrals"
status: approved
nyquist_compliant: true
wave_0_complete: false
created: "2026-10-22"
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest & Playwright (TypeScript) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/labs/ tests/referrals/ tests/storage/` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/labs/ tests/referrals/ tests/storage/`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | REQ-lab-records | T-04-01 | Relative paths only; R2/S3 secret validation | unit | `npx vitest run tests/storage/` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | REQ-lab-records | T-04-02 | Multi-tenant RLS isolation on documents | integration | `npx vitest run tests/labs/lab-documents.spec.ts` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 2 | REQ-lab-records | T-04-03 | Token expiry & access control | integration | `npx vitest run tests/labs/tokenized-sharing.spec.ts` | ❌ W0 | ⬜ pending |
| 04-02-02 | 02 | 2 | REQ-lab-records | T-04-04 | Sanitized file naming; MIME verification | integration | `npx vitest run tests/labs/lab-documents.spec.ts` | ❌ W0 | ⬜ pending |
| 04-03-01 | 03 | 3 | REQ-referrals | T-04-05 | Consent record immutability | integration | `npx vitest run tests/referrals/referrals-flow.spec.ts` | ❌ W0 | ⬜ pending |
| 04-03-02 | 03 | 3 | REQ-referrals | T-04-06 | Multi-tenant receiving access policy | integration | `npx vitest run tests/referrals/referrals-flow.spec.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/storage/storage-provider.spec.ts` — stubs for REQ-lab-records (storage adapter & S3/R2 parity)
- [ ] `tests/labs/lab-documents.spec.ts` — stubs for document upload and multi-tenant isolation
- [ ] `tests/labs/tokenized-sharing.spec.ts` — stubs for patient share token verification
- [ ] `tests/referrals/referrals-flow.spec.ts` — stubs for in-network and out-of-network referral lifecycle

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PDF Referral Letter Visual Layout | REQ-referrals | Visual verification of print margin & clinic letterhead | Generate referral PDF from consultation cabin, verify letterhead alignment, signature line, and responsive layout |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-10-22
