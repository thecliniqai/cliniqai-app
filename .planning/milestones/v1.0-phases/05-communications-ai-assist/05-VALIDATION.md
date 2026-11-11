---
phase: "05"
slug: "communications-ai-assist"
status: approved
nyquist_compliant: true
wave_0_complete: false
created: "2026-10-26"
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest & Playwright (TypeScript) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/messaging/ tests/notifications/ tests/ai/` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~12 seconds |

---

## Sampling Rate

- **After every task commit:** Run targeted suite (`npx vitest run tests/messaging/` or `tests/ai/` or `tests/notifications/`) + `npm run typecheck`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full test suite and lint must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | REQ-reminders-notifications | T-05-01 | Secure credentials, zero-leak dev logger | unit | `npx vitest run tests/messaging/messaging-provider.spec.ts` | ⬜ no | ⬜ pending |
| 05-01-02 | 01 | 1 | REQ-reminders-notifications | T-05-02 | Multi-tenant RLS isolation on queue & config | integration | `npx vitest run tests/messaging/outbox-queue.spec.ts` | ⬜ no | ⬜ pending |
| 05-01-03 | 01 | 1 | REQ-reminders-notifications | T-05-03 | Idempotent dispatch & quiet hours suppression | integration | `npx vitest run tests/messaging/outbox-queue.spec.ts` | ⬜ no | ⬜ pending |
| 05-02-01 | 02 | 2 | REQ-reminders-notifications | T-05-05 | Webhook signature check & slot release audit | integration | `npx vitest run tests/messaging/two-way-bot.spec.ts` | ⬜ no | ⬜ pending |
| 05-02-02 | 02 | 2 | REQ-reminders-notifications | T-05-06 | Expiring tokenized link access & revocation | integration | `npx vitest run tests/messaging/tokenized-sharing.spec.ts` | ⬜ no | ⬜ pending |
| 05-03-01 | 03 | 2 | REQ-reminders-notifications | T-05-08 | Multi-tenant RLS on in-app notifications | integration | `npx vitest run tests/notifications/in-app-notifications.spec.ts` | ⬜ no | ⬜ pending |
| 05-04-01 | 04 | 3 | REQ-ai-features | T-05-10 | Zero patient PII sent in AI prompts | unit | `npx vitest run tests/ai/ai-gateway.spec.ts` | ⬜ no | ⬜ pending |
| 05-04-02 | 04 | 3 | REQ-ai-features | T-05-11 | Zero-hallucination deterministic SQL for Rx | integration | `npx vitest run tests/ai/prescription-suggestions.spec.ts` | ⬜ no | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/messaging/messaging-provider.spec.ts` — stubs for REQ-reminders-notifications (provider factory, DevLogger, and SMS/WhatsApp drivers)
- [ ] `tests/messaging/outbox-queue.spec.ts` — stubs for outbox queue insertion, dispatch cycle, and quiet hours
- [ ] `tests/messaging/two-way-bot.spec.ts` — stubs for webhook signature validation, button parsing (`Confirm`, `Cancel`, `Reschedule`), and cancellation execution
- [ ] `tests/notifications/in-app-notifications.spec.ts` — stubs for in-app notification center data layer and multi-tenant isolation
- [ ] `tests/ai/ai-gateway.spec.ts` — stubs for REQ-ai-features (OpenAI REST spec, MockAiProvider, Zod SOAP validation)
- [ ] `tests/ai/prescription-suggestions.spec.ts` — stubs for deterministic SQL query execution over historical prescriptions

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Web Speech API Audio Dictation | REQ-ai-features | Requires physical browser microphone input | Open Consultation Cabin → click "AI Scribe" → speak clinical shorthand into microphone → verify speech converted to transcript |
| Top-Nav Notification Drawer Slide Animation | REQ-reminders-notifications | CSS transition and layout polish | Click Bell icon in desktop and mobile viewports → verify smooth slide-over, backdrop click-to-dismiss, and keyboard ESC |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all test references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-10-26
