# Phase 01: Foundation & Tenant Isolation - Context

**Gathered:** 2026-10-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 1 establishes the foundational infrastructure for ClinicQ: a fully isolated, audited multi-tenant platform on Next.js App Router and Supabase. It delivers clinic signup, staff OTP onboarding, server-side RBAC, patient data-layer compliance readiness (nullable ABHA, immutable consent records, structured clinical future-proofing), audit logging, and database-level tenant isolation enforced by Row Level Security (RLS).

</domain>

<decisions>
## Implementation Decisions

### Tech Stack & Dependencies
- **D-01:** **Lean root Next.js App Router.** Scaffold as a single root Next.js application (`app/`, `lib/`, `features/`, `components/` at the repository root). Only install the essential core needed for Phase 1: `next@latest`, `react`, `react-dom`, `@supabase/ssr`, `@supabase/supabase-js`, `zod`, `tailwindcss`, `lucide-react`. Omit heavy or premature client state/form dependencies (`@tanstack/react-query`, `react-hook-form`, `zustand`) until complex UI screens actually require them. — **Reversibility:** costly — changes root structure and npm dependency graph.
- **D-02:** **Direct Supabase database access behind typed internal service layer.** Keep Supabase access centralized in `lib/supabase/` and feature service layers (`features/*/`). Do not introduce an ORM (e.g. Drizzle, Prisma) or premature Alchemy abstractions. — **Reversibility:** costly — persistence interface abstraction.
- **D-03:** **Testing Runner Stack: Vitest + Playwright.** Use Vitest for fast unit tests and Supabase RLS integration tests; configure Playwright for E2E critical user journey tests (login, clinic setup, isolation smoke) as mandated by AGENTS.md §27 and §48. — **Reversibility:** reversible — testing configuration.

### Multi-Tenancy & Data Model
- **D-04:** **Many-to-Many memberships model from day one.** In addition to `tenants`, use a dedicated `memberships` table with `unique(user_id, tenant_id)` referencing `auth.users(id)` and `tenants(id)`. This anticipates visiting doctors/consultants across multiple clinics without requiring a later breaking schema migration. Active tenant context is derived server-side from session and membership. — **Reversibility:** one-way — database schema and primary authorization model.
- **D-05:** **Predefined enum roles & server-side RBAC.** Supported roles in Phase 1: `'owner'`, `'admin'`, `'doctor'`, `'receptionist'`, `'nurse'`. Role permissions are checked strictly on the server (in service guards and database RLS); UI hiding is never treated as authorization. — **Reversibility:** costly — authorization matrix touches all server actions.
- **D-06:** **Dedicated invitations table with atomic consumption.** Staff invitations are tracked in `invitations` (`tenant_id`, `role`, `invitee_contact`, `hashed_token`, `expires_at`, `used_at`). Consumed atomically via a `security definer` database function to prevent race conditions or duplicate memberships. — **Reversibility:** costly — invitation and onboarding flow.
- **D-07:** **Database-backed subscription visibility.** A read-only `subscriptions` table (standard plan ₹1,000/mo, status, billing period) protected by RLS, readable exclusively by Owner/Admin. No payment gateway integration in Phase 1. — **Reversibility:** reversible — read-only billing schema.

### Authentication & UI Flows
- **D-08:** **Supabase Auth Email OTP.** Use Supabase Auth Email OTP for staff authentication. In local and automated test environments, utilize the Supabase Admin API to generate and verify OTP links without external email delivery dependencies. — **Reversibility:** reversible — auth delivery channel.
- **D-09:** **Focused 2-step clinic onboarding.** (1) Basic details: Clinic name, address, primary specialty; (2) Optional working hours schedule. Redirects immediately to dashboard on creation. — **Reversibility:** reversible — onboarding UX flow.
- **D-10:** **Strict DESIGN.md & Mobile-First compliance.** Enforce DESIGN.md light-theme canonical tokens (`#1769E0` primary, `#F7F6F3` background, standard typography and radius scales). All screens must be responsive and mobile-first: single-column on 375px+ screens, touch targets >= 44px, keyboard navigation, accessible error handling. No dark mode, no arbitrary Tailwind colors, no desktop-first assumptions. — **Reversibility:** costly — UI component primitives and styling.

### Discretion
- **D-11:** Test helper implementation details: Use service-role client strictly in `tests/helpers/` for seeding and user generation; application runtime code must never import service-role credentials.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architecture & Engineering Rules
- `AGENTS.md` §1–§2 — Mission, instruction priority, and modular monolith principles
- `AGENTS.md` §5 — Technology stack (Next.js App Router, Supabase, @supabase/ssr, Zod, Tailwind)
- `AGENTS.md` §7 — Multi-tenancy rules and server-side tenant derivation
- `AGENTS.md` §8 — Identity, authentication, and RBAC authorization
- `AGENTS.md` §9–§10 — Healthcare sensitive data handling and auditability requirements
- `AGENTS.md` §14 — Database rules, migration safety, and transactions
- `AGENTS.md` §22 — Frontend architecture and `features/` organization
- `AGENTS.md` §26 — Mobile-first responsive design as a first-class platform
- `AGENTS.md` §27–§28 — Testing strategy (Vitest, Playwright E2E, verification checklist)

### Design & Visual System
- `DESIGN.md` §2 — Non-negotiable design principles (light theme only, no gradients, no pills)
- `DESIGN.md` §5.1 — Core design tokens (colors, typography, spacing, radius)
- `DESIGN.md` §7–§8 — Component rules, interaction states, and accessibility
- `DESIGN.md` §41 — Component catalog and reuse requirements

### Product Requirements
- `docs/clinic-management-prd.md` §1–§4 — Target users, pricing, and functional specifications
- `docs/clinic-management-prd.md` §4.13 — Compliance data-layer readiness (ABDM, ABHA, FHIR structures)
- `docs/clinic-management-prd.md` §5–§7 — Non-functional requirements, technical starting point, and core data model

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None. Greenfield pre-scaffold repository (21 tracked planning files, zero application code).

### Established Patterns
- All new code must follow the single root Next.js App Router structure: `app/`, `features/`, `components/`, `lib/`, `tests/`, `supabase/migrations/`.
- Strict type safety with Zod schemas and TypeScript strict mode.

### Integration Points
- Supabase Project: Database (Postgres + RLS), Auth (Email OTP), and local CLI migrations.
- Test suite: Vitest for unit & RLS integration tests + Playwright for E2E journeys.

</code_context>

<specifics>
## Specific Ideas

- Keep dependencies minimal in initial `package.json` to avoid bloat and reduce bundle overhead.
- Ensure all input fields have explicit labels, visible focus rings, and proper touch target sizes (>= 44px) for mobile-first clinic usage.

</specifics>

<deferred>
## Deferred Ideas

- SMS OTP integration via third-party providers (Twilio/MSG91) — deferred to Phase 5 (Communications).
- Dynamic permission management / custom role creation — not needed for Phase 1.
- Live ABDM/ABHA verification APIs and HL7 FHIR server export — deferred to future phases (Phase 1 establishes nullable fields and transformable schemas only).
- Client state management stores (Zustand) and heavy form libraries (React Hook Form) — introduce only when complex forms/state dictate.

</deferred>

---

*Phase: 01-foundation-tenant-isolation*
*Context gathered: 2026-10-07*
