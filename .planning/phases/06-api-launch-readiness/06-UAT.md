---
status: testing
phase: 06-api-launch-readiness
source: [06-VERIFICATION.md]
started: 2026-11-09T17:28:00Z
updated: 2026-11-09T17:28:00Z
---

## Current Test

number: 1
name: Developer Settings & Single-Reveal API Key Modal
expected: |
  Raw key is shown once in monospace font with amber warning banner, clipboard copy works, modal close hides key permanently.
awaiting: user response

## Tests

### 1. Developer Settings & Single-Reveal API Key Modal
expected: Raw key is shown once in monospace font with amber warning banner, clipboard copy works, modal close hides key permanently.
result: [pending]

### 2. Webhook Subscription & Delivery Logs Drawer
expected: 480px slide-over drawer animates smoothly, displays delivery history list with status badges and latencies, and shows raw JSON payload on item click.
result: [pending]

### 3. DPDP Dual-Format Export & Global Consent Toggle
expected: JSON file and multi-page styled medical summary PDF download cleanly in browser; consent toggle updates state with immediate toast confirmation.
result: [pending]

### 4. Interactive OpenAPI Documentation Viewer
expected: Scalar interactive API reference loads cleanly in light mode with full endpoint documentation, request schemas, and responses.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
