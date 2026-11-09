---
phase: "06"
slug: "api-launch-readiness"
status: draft
nyquist_compliant: true
wave_0_complete: false
created: "2026-11-09"
---

# Phase 06 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest `^3.0.8` |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/api` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/api`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | REQ-api-access | T-06-01 | Bearer token hashing, prefix indexing, and timingSafeEqual validation | integration | `npx vitest run tests/api/v1-auth.spec.ts` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 1 | REQ-api-access | T-06-03 | Strict RLS-bound tenant isolation across all entity CRUD operations | integration | `npx vitest run tests/api/v1-crud.spec.ts` | ❌ W0 | ⬜ pending |
| 06-01-03 | 01 | 1 | REQ-api-access | T-06-03 | Enforce doctor staff role validation on visit and prescription mutations | integration | `npx vitest run tests/api/v1-doctor-guard.spec.ts` | ❌ W0 | ⬜ pending |
| 06-02-01 | 02 | 2 | REQ-api-access | T-06-02 | HMAC-SHA256 signature with signed timestamp header preventing replay attacks | integration | `npx vitest run tests/api/webhooks-outbox.spec.ts` | ❌ W0 | ⬜ pending |
| 06-02-02 | 02 | 2 | REQ-nfr-reliability | T-06-05 | Transactional outbox non-blocking delivery and exponential backoff retry | integration | `npx vitest run tests/api/webhooks-outbox.spec.ts` | ❌ W0 | ⬜ pending |
| 06-02-03 | 02 | 2 | REQ-api-access | T-06-06 | 120 req/min sliding window rate limit with 429 response and headers | integration | `npx vitest run tests/api/rate-limiting.spec.ts` | ❌ W0 | ⬜ pending |
| 06-03-01 | 03 | 3 | REQ-nfr-regulatory-compliance | T-06-04 | Dual-format DPDP export (machine-readable JSON + medical summary PDF) | integration | `npx vitest run tests/compliance/dpdp-rights.spec.ts` | ❌ W0 | ⬜ pending |
| 06-03-02 | 03 | 3 | REQ-nfr-regulatory-compliance | T-06-04 | Soft delete erasure (`status = 'erased'`) reconciling NMC 3-year retention | integration | `npx vitest run tests/compliance/dpdp-rights.spec.ts` | ❌ W0 | ⬜ pending |
| 06-04-01 | 04 | 4 | REQ-nfr-regulatory-compliance | T-06-04 | Permanent neutralization of dev auth logger in production mode | unit | `npx vitest run tests/security/dev-logger-lockout.spec.ts` | ❌ W0 | ⬜ pending |
| 06-04-02 | 04 | 4 | REQ-nfr-reliability | — | Health probes `/api/health` and `/api/ready` verify DB and queue status | integration | `npx vitest run tests/api/health-probes.spec.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/api/v1-auth.spec.ts` — stubs for API key authentication, prefix lookup, and hashing
- [ ] `tests/api/v1-crud.spec.ts` — stubs for entity REST endpoints
- [ ] `tests/api/webhooks-outbox.spec.ts` — stubs for webhook outbox and HMAC signing
- [ ] `tests/compliance/dpdp-rights.spec.ts` — stubs for DPDP export and erasure
- [ ] `tests/security/dev-logger-lockout.spec.ts` — stubs for dev logger production lockout

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Developer API Keys & Webhooks Settings Tab UI | REQ-api-access | Visual UI/UX layout in browser | Open `/settings/clinic`, click API & Webhooks tab, create key, copy token, verify table display |
| OpenAPI 3.0 Interactive Docs UI | REQ-api-access | Browser rendering of interactive API reference | Open `/api/v1/docs` in browser, verify endpoint list, schema display, and try-it-out console |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 20s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-11-09
