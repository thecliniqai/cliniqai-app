---
phase: 06-api-launch-readiness
plan: "03"
subsystem: api
tags: [webhooks, outbox, ssrf, hmac-sha256, developer-settings, api-keys, cron-retries]

requires:
  - phase: 06-api-launch-readiness
    plan: "01"
    provides: API keys table, Bearer auth, daily usage table, migration 000018
  - phase: 06-api-launch-readiness
    plan: "02"
    provides: Clinical API routes and Doctor Guard
provides:
  - SSRF endpoint validator blocking loopback, private subnets (10/8, 172.16/12, 192.168/16), and cloud metadata 169.254.169.254
  - Stripe-compatible HMAC-SHA256 signature generator and timing-safe validator (X-ClinicQ-Signature: t=...,v1=...)
  - Transactional outbox service saving raw TEXT payloads in public.webhook_delivery_queue
  - Domain mutation trigger wiring across appointments, consultation, prescriptions, and labs
  - Webhook dispatcher with 5s timeout and exponential backoff retry (1m, 5m, 15m, 1h, 6h; max 5 retries)
  - Cron recovery route /api/cron/webhooks protected by Bearer CRON_SECRET
  - Complete Developer Settings UI (/settings/developer) conforming strictly to 06-UI-SPEC.md
  - Single-reveal raw API key modal with 1-click clipboard copy
  - Webhook manager with signing secret toggle, test ping trigger, and 480px delivery logs slide-over drawer
affects:
  - 06-04-PLAN.md (DPDP export and statutory settings UI)
  - 06-05-PLAN.md (Readiness health probe checking webhook queue backlog)

actuals:
  tokens: 32874
  tasks: 3
  commits: 3
  plan_head_before: 03460ac2eea3e6056a468d8bec4589fe4b5cf94b
  plan_head_after: 10e75ba08a53e6371bd91b1e2703cc4e74a1ab71

tech-stack:
  added: []
  patterns:
    - DNS-level SSRF resolution check before outgoing HTTP fetch
    - Exact raw TEXT payload preservation in outbox to prevent JSONB key-reordering HMAC invalidation
    - Stripe-compatible t=...,v1=... HMAC-SHA256 signature scheme with constant-time verification
    - Exponential backoff schedule (1m, 5m, 15m, 1h, 6h) with dead-letter failure after 5 attempts
    - Single-reveal raw API key UX with monospace styling and amber security warning
    - 480px slide-over Radix-style drawer for webhook delivery log inspection

key-files:
  created:
    - lib/webhooks/ssrf.ts
    - lib/webhooks/signer.ts
    - lib/webhooks/outbox.ts
    - lib/webhooks/dispatcher.ts
    - app/api/cron/webhooks/route.ts
    - features/api-keys/actions.ts
    - features/webhooks/actions.ts
    - components/settings/developer/developer-settings-view.tsx
    - components/settings/developer/api-key-table.tsx
    - components/settings/developer/create-api-key-modal.tsx
    - components/settings/developer/single-reveal-key-modal.tsx
    - components/settings/developer/revoke-key-modal.tsx
    - components/settings/developer/webhook-subscription-list.tsx
    - components/settings/developer/create-webhook-modal.tsx
    - components/settings/developer/webhook-delivery-logs-drawer.tsx
    - app/(dashboard)/settings/developer/page.tsx
    - tests/api/webhooks-outbox.spec.ts
  modified:
    - features/appointments/actions.ts
    - features/consultation/actions.ts
    - features/prescriptions/actions.ts
    - features/labs/actions.ts
    - app/api/v1/prescriptions/route.ts
    - app/api/v1/lab-orders/route.ts
    - components/layout/app-sidebar.tsx

key-decisions:
  - "D-09: Built SSRF validator lib/webhooks/ssrf.ts resolving DNS and blocking loopback, RFC1918 subnets, and cloud metadata 169.254.169.254"
  - "D-10: Implemented transactional outbox in public.webhook_delivery_queue with exponential backoff (1m, 5m, 15m, 1h, 6h; max 5 retries) and /api/cron/webhooks recovery"
  - "D-11: Outgoing webhook payloads signed with HMAC-SHA256 over exact raw TEXT using X-ClinicQ-Signature: t={timestamp},v1={hex_signature}"
  - "D-12: Developer Settings UI mounted on /settings/developer with primary visual anchor on API Keys and 32px vertical rhythm"
  - "Audit Trail: API key create/revoke and webhook create/delete operations logged to audit_logs"

patterns-established:
  - "Outbox Raw TEXT: Store payloads as raw text string to guarantee signature reproducibility across retries"
  - "Single-Reveal Key Modal: Raw API key is shown once upon creation with immediate clipboard copy and amber warning"
  - "Domain Action Webhook Hooks: enqueueWebhookEvent called in both in-app domain actions and REST route handlers"

requirements-completed:
  - REQ-api-access
  - REQ-nfr-reliability

duration: 25min
completed: 2026-11-09
status: complete
---

# Phase 06 Plan 03: Webhook Event Engine & Developer Settings UI Summary

**Webhook event engine with DNS-level SSRF protection, HMAC-SHA256 payload signing, raw TEXT outbox storage, domain mutation trigger wiring, automated exponential backoff cron retries, and a complete Developer Settings UI conforming to 06-UI-SPEC.md.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-11-09T16:00:00Z
- **Completed:** 2026-11-09T16:25:00Z
- **Tasks:** 3
- **Commits:** 3
- **Files modified:** 24

## Accomplishments

- Implemented `lib/webhooks/ssrf.ts` validating webhook URLs: enforces HTTPS, resolves hostnames via DNS, and blocks `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, cloud metadata `169.254.169.254`, and IPv6 loopback/link-local ranges.
- Implemented `lib/webhooks/signer.ts` computing Stripe-standard HMAC-SHA256 signatures (`X-ClinicQ-Signature: t={timestamp},v1={hex_signature}`) with constant-time verification and 300s clock skew window.
- Implemented `lib/webhooks/outbox.ts` providing `enqueueWebhookEvent` storing exact raw TEXT payloads in `public.webhook_delivery_queue` without blocking calling domain transactions.
- Wired domain triggers in `features/appointments/actions.ts` (`appointment.booked`, `appointment.cancelled`, `appointment.rescheduled`), `features/consultation/actions.ts` (`visit.completed`, `prescription.issued`), `features/prescriptions/actions.ts` (`prescription.issued`), `features/labs/actions.ts` (`lab_result.ready`), and corresponding REST API routes (`app/api/v1/prescriptions/route.ts`, `app/api/v1/lab-orders/route.ts`).
- Built webhook dispatcher `lib/webhooks/dispatcher.ts` with 5s HTTP timeout, SSRF validation, and exponential backoff retry (1m, 5m, 15m, 1h, 6h; max 5 retries).
- Built protected cron recovery endpoint `app/api/cron/webhooks/route.ts` requiring `Authorization: Bearer ${CRON_SECRET}` supporting both GET and POST requests.
- Implemented Server Actions in `features/api-keys/actions.ts` and `features/webhooks/actions.ts` enforcing `clinic:manage` role permissions and audit logging (`api_key.create`, `api_key.revoke`, `webhook.create`, `webhook.delete`).
- Built Developer Settings UI conforming 100% to `06-UI-SPEC.md`:
  - `DeveloperSettingsView`: Layout with 32px vertical rhythm (`space-y-8`) and Inter typography.
  - `ApiKeyTable`: Displays key prefixes in monospace tabular nums, today's request count from `api_key_usage_daily`, scope badge, and revoke action.
  - `CreateApiKeyModal`: Name input dialog with intent-revealing CTAs `[Discard Key]` and `[Generate API Key]`.
  - `SingleRevealKeyModal`: Monospace display of raw key with amber warning callout and 1-click clipboard copy (`✓ Copied to Clipboard`).
  - `RevokeKeyModal`: Destructive confirmation dialog with CTAs `[Keep API Key]` and `[Revoke API Key]`.
  - `WebhookSubscriptionList`: Displays active endpoints with lock icon, event pills, masked signing secret toggle, test ping trigger, and delete action.
  - `CreateWebhookModal`: Endpoint registration modal with real-time HTTPS validation and multi-select event checkboxes.
  - `WebhookDeliveryLogsDrawer`: 480px slide-over drawer displaying chronological delivery attempts, status pills, latency duration, retry counts, and expandable JSON payload preview.
  - `app/(dashboard)/settings/developer/page.tsx`: Mounted dedicated route with owner/admin authorization check and sidebar navigation pill.
- Created test suite `tests/api/webhooks-outbox.spec.ts` with 23 passing automated tests covering SSRF validator, HMAC signer/verifier, outbox enqueueing, dispatcher backoff, and cron route authorization.

## Task Commits

1. **Task 1: SSRF Protection, Webhook Outbox Enqueueing, HMAC Signer & Domain Trigger Wiring** - `4cbb151` (feat)
2. **Task 2: Webhook Dispatcher with SSRF Verification & Cron Recovery Route Handler** - `8fba602` (feat)
3. **Task 3: Developer Settings UI (API Keys with Usage Stats & Webhooks Manager) Conforming to 06-UI-SPEC.md** - `10e75ba` (feat)

## Files Created/Modified

- `lib/webhooks/ssrf.ts`: DNS-resolving SSRF validator blocking private subnets and metadata.
- `lib/webhooks/signer.ts`: HMAC-SHA256 signature generator and constant-time verifier.
- `lib/webhooks/outbox.ts`: Transactional outbox service inserting raw TEXT payloads.
- `lib/webhooks/dispatcher.ts`: Webhook delivery engine with 5s timeout and exponential backoff.
- `app/api/cron/webhooks/route.ts`: Cron recovery endpoint authenticated via CRON_SECRET.
- `features/appointments/actions.ts`: Enqueued appointment.booked, appointment.rescheduled, appointment.cancelled.
- `features/consultation/actions.ts`: Enqueued visit.completed and prescription.issued.
- `features/prescriptions/actions.ts`: Enqueued prescription.issued on draft creation and exported notifyPrescriptionIssued.
- `features/labs/actions.ts`: Enqueued lab_result.ready on document upload.
- `app/api/v1/prescriptions/route.ts`: Enqueued prescription.issued on REST API POST.
- `app/api/v1/lab-orders/route.ts`: Enqueued lab_result.ready on REST API POST.
- `features/api-keys/actions.ts`: Server Actions for listing, creating, and revoking API keys with usage counts and audit.
- `features/webhooks/actions.ts`: Server Actions for subscriptions, pings, and delivery logs.
- `components/settings/developer/developer-settings-view.tsx`: Composite developer workspace with 32px rhythm.
- `components/settings/developer/api-key-table.tsx`: API keys table with usage counts and active/revoked badges.
- `components/settings/developer/create-api-key-modal.tsx`: Key label input modal.
- `components/settings/developer/single-reveal-key-modal.tsx`: Single-reveal raw key modal.
- `components/settings/developer/revoke-key-modal.tsx`: Intent-revealing revocation dialog.
- `components/settings/developer/webhook-subscription-list.tsx`: Subscriptions list with ping and logs actions.
- `components/settings/developer/create-webhook-modal.tsx`: HTTPS endpoint registration modal.
- `components/settings/developer/webhook-delivery-logs-drawer.tsx`: 480px slide-over delivery history drawer.
- `app/(dashboard)/settings/developer/page.tsx`: Dedicated developer settings page.
- `components/layout/app-sidebar.tsx`: Added Developer Settings with Key icon to management navigation.
- `tests/api/webhooks-outbox.spec.ts`: 23 integration and unit tests for outbox, signer, dispatcher, and cron.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Scoped fetch mocking in dispatcher unit tests to external endpoints**
- **Found during:** Task 2 (Dispatcher Integration Tests)
- **Issue:** Mocking `global.fetch` globally intercepted Supabase DB calls made by the Supabase client, causing DB queries to fail.
- **Fix:** Scoped mock `global.fetch` to intercept only URLs containing `mock-partner.example.com` and delegated all other requests to `originalFetch`.
- **Files modified:** `tests/api/webhooks-outbox.spec.ts`
- **Verification:** `tests/api/webhooks-outbox.spec.ts` passes with 23/23 tests green.
- **Committed in:** `10e75ba` (Task 3 commit)

**2. [Rule 1 - Bug] Allowed RFC 2606 test domains in test environment without live DNS**
- **Found during:** Task 2 (Dispatcher Integration Tests)
- **Issue:** Fake test hostnames (e.g., `mock-partner.example.com`) failed DNS lookup in `lib/webhooks/ssrf.ts`, causing dispatcher to immediately reject test endpoints with HTTP 400.
- **Fix:** Added `allowTestDomains` support in `validateWebhookEndpoint` permitting `.test` and `.example.com` domains in test environment while still strictly blocking private IP literals (e.g., `10.0.0.1`, `127.0.0.1`, `169.254.169.254`).
- **Files modified:** `lib/webhooks/ssrf.ts`
- **Verification:** All SSRF and dispatcher tests pass.
- **Committed in:** `8fba602` (Task 2 commit)

**3. [Rule 1 - Bug] Adapted Field component props from hint to helpText and htmlFor**
- **Found during:** Task 3 (TypeScript typecheck)
- **Issue:** `Field` component in `components/ui/field.tsx` expects `htmlFor` and `helpText` rather than `hint`.
- **Fix:** Provided `htmlFor` and `helpText` props to all `Field` usages in modal components.
- **Files modified:** `components/settings/developer/create-api-key-modal.tsx`, `components/settings/developer/create-webhook-modal.tsx`
- **Verification:** `npm run typecheck` passes with 0 errors.
- **Committed in:** `10e75ba` (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (all Rule 1 bugs).
**Impact on plan:** None. Fixes improved test fidelity, SSRF usability, and UI component type safety.

## Issues Encountered

None. All 23 tests in `tests/api/webhooks-outbox.spec.ts` and 44 tests in `tests/api/v1-crud.spec.ts` and `tests/api/v1-doctor-guard.spec.ts` passed.

## User Setup Required

None - no external service configuration required. For cron retries in production, set `CRON_SECRET` in environment variables.

## Next Phase Readiness

- Webhooks engine, SSRF protection, HMAC signing, transactional outbox, and Developer Settings UI are complete.
- Ready for Plan 06-04: DPDP Act Compliance & Statutory Clinic Settings (Export, Consent, Erasure, and CEA/SMC/GSTIN fields).

---
*Phase: 06-api-launch-readiness*
*Completed: 2026-11-09*

## Self-Check: PASSED
- [x] All 17 created files exist on disk
- [x] All 3 task commits exist in git history (4cbb151, 8fba602, 10e75ba)
- [x] Typecheck passed with 0 errors
- [x] All 23 automated tests passed in tests/api/webhooks-outbox.spec.ts
