---
phase: "05"
plan: "01"
subsystem: communications
tags:
  - messaging
  - outbox
  - governance
  - dev-logger
  - msg91
  - twilio
  - gupshup
  - cron
  - migrations
  - rls
requires:
  - phase: "01"
    plan: "01"
  - phase: "04"
    plan: "01"
provides:
  - "Multi-provider messaging abstraction in lib/messaging/ supporting DevLogger, MSG91, Twilio, and Gupshup"
  - "Database schema and TypeScript interfaces for communication_queue, tenant_messaging_config, and in_app_notifications with multi-tenant RLS"
  - "Two-tier message governance engine with IST quiet hours deferral (21:00 to 08:00 IST) and clinic monthly quota protection"
  - "Resilient outbox queue dispatcher with exponential backoff and conditional SMS fallback"
  - "Secured cron recovery endpoint /api/cron/dispatch-communications protected by CRON_SECRET"
  - "Wave 0 test stubs established across messaging, notifications, and AI suites"
affects:
  - lib/db/types
  - lib/messaging
  - app/api/cron
  - tests/messaging
  - tests/notifications
  - tests/ai
tech-stack:
  added: []
  patterns:
    - "Transactional outbox queue pattern for clinical communication decoupling"
    - "Multi-provider driver strategy pattern with automatic DevLogger fallback"
    - "Two-tier governance policy (Company Master -> Clinic Config -> Patient Preferences -> Quiet Hours)"
    - "Progressive exponential backoff retry (1m, 5m, 15m) with dead-letter queueing"
key-files:
  created:
    - supabase/migrations/000014_communications_and_ai.sql
    - lib/messaging/types.ts
    - lib/messaging/dev-logger.ts
    - lib/messaging/providers/msg91.ts
    - lib/messaging/providers/twilio.ts
    - lib/messaging/providers/gupshup.ts
    - lib/messaging/governance.ts
    - lib/messaging/dispatcher.ts
    - lib/messaging/index.ts
    - app/api/cron/dispatch-communications/route.ts
    - tests/messaging/messaging-provider.spec.ts
    - tests/messaging/outbox-queue.spec.ts
    - tests/messaging/two-way-bot.spec.ts
    - tests/notifications/in-app-notifications.spec.ts
    - tests/ai/ai-gateway.spec.ts
    - tests/ai/prescription-suggestions.spec.ts
  modified:
    - lib/db/types.ts
decisions:
  - "Built zero-cost DevLogger provider writing formatted ANSI terminal banners and appending to .planning/dev-messages.txt"
  - "Implemented dual-trigger outbox queue architecture with transactional enqueueing and background cron recovery"
  - "Enforced quiet hours from 21:00 to 08:00 IST for non-urgent notifications with nextRetryAt scheduled for 08:01 IST"
  - "Secured cron queue endpoint with Authorization Bearer CRON_SECRET header requirement"
metrics:
  duration: 10m
  completed_date: "2026-10-26"
status: complete
commits: 4
requirements:
  - REQ-reminders-notifications
---

# Phase 05 Plan 01: Messaging Foundation, Database Migrations, and Outbox Queue Summary

**Execution Result:** SUCCESS  
**Subsystem:** Communications & Messaging Infrastructure  
**Duration:** ~10 min  
**Completed Date:** 2026-10-26  

## Accomplishments

1. **Wave 0 Test Skeletons & Stubs:**
   - Established complete test harness across `tests/messaging/` (provider, outbox queue, two-way bot), `tests/notifications/` (in-app notifications), and `tests/ai/` (universal gateway, deterministic prescription suggestions).
   - Validated clean vitest execution and zero TypeScript compilation issues.

2. **Database Migration `000014_communications_and_ai.sql` & TypeScript Types:**
   - Authored SQL migration creating `communication_queue`, `tenant_messaging_config`, and `in_app_notifications` with multi-tenant RLS isolation policies `tenant_id IN (SELECT public.current_user_tenant_ids())`.
   - Altered `patients` table to record `preferred_language` ('en' | 'mr'), `whatsapp_opt_out`, and pediatric guardian demographics.
   - Altered `document_share_tokens` table to make `document_id` nullable and add polymorphic `resource_type` and `resource_id`.
   - Updated `lib/db/types.ts` with matching exported interfaces.

3. **Multi-Provider Messaging Abstraction (`lib/messaging/`):**
   - Implemented `MessagingProvider` interface with factory `getMessagingProvider()`.
   - Created `DevLoggerProvider` formatting messages with clean borders, logging to console, and appending to `.planning/dev-messages.txt`.
   - Implemented production driver stubs for MSG91 (Flow API & WhatsApp), Twilio (SMS & WhatsApp), and Gupshup (Enterprise WhatsApp).
   - Created direct dispatch helpers `sendDirectSms` and `sendDirectWhatsApp`.

4. **Two-Tier Governance Engine, Outbox Dispatcher & Cron Route:**
   - Implemented `lib/messaging/governance.ts` evaluating monthly quota exhaustion, patient WhatsApp opt-outs, and IST quiet hours (21:00 to 08:00 IST).
   - Implemented `lib/messaging/dispatcher.ts` supporting `enqueueMessage`, `dispatchPendingQueue`, exponential backoff calculation (1m, 5m, 15m), dead-letter status, and audit log generation.
   - Built protected endpoint `app/api/cron/dispatch-communications/route.ts` validating `Authorization: Bearer <CRON_SECRET>`.

## Self-Check: PASSED

- All 16 key files created on disk.
- All 4 task git commits present in repository history (`5b1b494`, `2128aaa`, `1bca5d2`, `affa6b9`).
- Vitest suites in `tests/messaging/` passing with 24 tests passing.
- `npm run typecheck` passing with zero errors.
