# Phase 1: Foundation & Tenant Isolation - Discussion Log

**Date:** 2026-10-07
**Participants:** Siddharth (Founder/Lead) & Antigravity (AI Assistant)

## Summary

Discussed alignment between Phase 1 requirements and the engineering constitution in `AGENTS.md` and `DESIGN.md`. Locked core architectural decisions, eliminated dependency drift, and established clean boundaries for the upcoming phase replan.

## Key Decisions Recorded

1. **Tech Stack & Dependencies (AGENTS.md §5)**
   - Lean root Next.js App Router scaffold.
   - Core packages only: `next@latest`, `react`, `react-dom`, `@supabase/ssr`, `@supabase/supabase-js`, `zod`, `tailwindcss`, `lucide-react`.
   - Deferred: `@tanstack/react-query`, `react-hook-form`, `zustand` until multi-step or complex client state screens require them.
   - Single root modular monolith layout (`app/`, `features/`, `components/`, `lib/`).
   - Testing: Vitest for unit & RLS integration tests + Playwright configured for E2E critical journeys per AGENTS.md §27/§48.
   - Database: Direct access via `@supabase/ssr` behind internal service boundaries; no ORMs or premature abstractions.

2. **Multi-Tenancy & Data Model (AGENTS.md §7, §8)**
   - Many-to-Many `memberships` table (`unique(user_id, tenant_id)`) from day one to support visiting/multi-clinic doctors.
   - Server-enforced predefined enum roles (`owner`, `admin`, `doctor`, `receptionist`, `nurse`).
   - Dedicated `invitations` table with single-use, atomic consumption via security-definer function.
   - Read-only `subscriptions` table visible to Owner/Admin only via RLS.

3. **Authentication & UI Flows (AGENTS.md §25, §26, DESIGN.md)**
   - Supabase Auth Email OTP for staff auth; Admin API helper for instant local/test validation.
   - Focused 2-step clinic setup (basic details + optional hours) with immediate redirect to dashboard.
   - Mobile-first responsive UI (375px+ single column, >=44px touch targets), light-theme only, accessible navigation, adhering to DESIGN.md tokens.

