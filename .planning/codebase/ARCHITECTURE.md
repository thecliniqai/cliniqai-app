<!-- refreshed: 2026-10-06 -->
# Architecture

**Analysis Date:** 2026-10-06

> **Current state:** This repository contains **no application code**. As of this analysis there is no `package.json`, no `tsconfig.json`, no `src/`, no `app/`, no migrations, no tests, no CI config, no `README.md`, and no `.env.example` anywhere in the repo (verified by full-tree scan excluding `.git/` and `.opencode/`). The git repository has **zero commits** — every file is untracked. The architecture described below under "Documented Intent" is aspirational and comes from `AGENTS.md`, `DESIGN.md`, and `docs/clinic-management-prd.md`; it is NOT yet implemented on disk. Sections marked **Not implemented** describe what does not exist.

## System Overview (current state)

```text
┌─────────────────────────────────────────────────────────────┐
│                     Repository (clinicOS)                    │
│              git: main — 0 commits, all files untracked      │
├──────────────────┬──────────────────┬───────────────────────┤
│  Engineering     │  Design          │  Product              │
│  constitution    │  system          │  requirements         │
│  `AGENTS.md`     │  `DESIGN.md`     │  `docs/clinic-        │
│  (1,698 lines)   │  (2,200 lines)   │  management-prd.md`   │
└──────────────────┴──────────────────┴───────────────────────┘
         │                  │                     │
         └──────────┬───────┴─────────────────────┘
                    ▼
┌─────────────────────────────────────────────────────────────┐
│  Planning metadata (not product code)                        │
│  `.planning/codebase/` — codebase map docs                   │
│  `.opencode/` — OpenCode/GSD agent tooling, skills, hooks    │
└─────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│  Application code: NONE — not yet scaffolded                 │
│  (no Next.js app, no Supabase client, no DB, no tests)       │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities (what actually exists)

| Component | Responsibility | File |
|-----------|----------------|------|
| Engineering constitution | Binding rules for architecture, stack, security, multi-tenancy, testing, delivery | `AGENTS.md` |
| Design authority | Single source of truth for all UI/UX, tokens, components, accessibility | `DESIGN.md` |
| Product requirements | Functional/non-functional requirements, target data model, stack rationale | `docs/clinic-management-prd.md` |
| Codebase map | Generated analysis docs (STACK, CONVENTIONS, TESTING, INTEGRATIONS, + these) | `.planning/codebase/` |
| Agent tooling | OpenCode/GSD skills, commands, hooks, plugins used to run this project's workflows | `.opencode/` |

No runtime components exist. There are no modules, services, routes, or database objects on disk.

## Pattern Overview

**Overall (current):** Documentation-only brownfield pre-scaffold. No architectural pattern is implemented because no code exists.

**Overall (documented intent):** Modular monolith — Next.js App Router frontend + Next.js server primitives (Server Components, Server Actions, Route Handlers) as the backend, on Supabase (Postgres + Auth + RLS + Storage), deployed to Vercel.

**Key characteristics of the intended pattern** (source: `AGENTS.md` §5–§6, `docs/clinic-management-prd.md` §6):
- One deployable Next.js application; no separate API service unless a concrete requirement forces it (`AGENTS.md` §5 "Backend").
- Logical modules with clear ownership: Auth/Identity, Tenants, Users, Patients, Appointments, Check-in/Queue, Consultations, Prescriptions, Lab Reports, Referrals, Billing, Notifications, Documents, Reports, Audit, Settings (`AGENTS.md` §6.1).
- Server-side tenant boundary enforced via Supabase RLS + derived tenant context, never browser-supplied tenant IDs (`AGENTS.md` §7).
- External vendors (SMS, WhatsApp, payments, storage, AI) wrapped behind provider adapters (`AGENTS.md` §41).
- "A boring architecture that works reliably is better than an impressive architecture" — explicitly no microservices, no Kubernetes, no event-driven-everything (`AGENTS.md` §49).

## Documented Intent — Target Architecture

*Everything in this section is aspirational; reference only. Nothing below exists on disk.*

```text
┌─────────────────────────────────────────────────────────────┐
│  Next.js App Router (apps/web or repo root)                  │
│  Server Components (default) · Client Components (interactive)│
│  `app/` route tree · Server Actions · Route Handlers         │
├──────────────────┬──────────────────┬───────────────────────┤
│  features/       │  components/     │  hooks/               │
│  patients,       │  shared UI       │  client hooks         │
│  appointments,   │  (genuinely      │                       │
│  consultations…  │   reusable only) │                       │
└────────┬─────────┴────────┬─────────┴──────────┬────────────┘
         │                  │                     │
         ▼                  ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│  Domain / data-access layer                                  │
│  typed service & repository functions — provider-agnostic    │
│  `lib/` · feature-level data-access modules                  │
│  (validation via Zod shared schemas)                         │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  Supabase: Postgres + Auth + RLS + Storage                   │
│  `lib/supabase/` (@supabase/ssr cookie-based SSR sessions)   │
│  RLS = mandatory tenant-isolation boundary                   │
└─────────────────────────────────────────────────────────────┘
         │
         ▼ (async, behind adapters)
┌─────────────────────────────────────────────────────────────┐
│  External providers: SMS/WhatsApp, payments, AI, storage     │
│  adapter interfaces in-app — vendor SDKs never scattered      │
└─────────────────────────────────────────────────────────────┘
```

## Layers

### Current layers

Only two "layers" exist, and neither contains product code:

- **Authoritative documents:** `AGENTS.md` (engineering rules), `DESIGN.md` (UI/UX rules), `docs/clinic-management-prd.md` (requirements). These are inputs, not implementation.
- **Tooling/metadata:** `.opencode/` (agent runtime), `.planning/` (planning artifacts).

### Intended layers (documented intent — NOT implemented)

**Presentation (Next.js App Router):**
- Purpose: render pages, collect input, optimistic UX.
- Intended location: `app/` route tree (does not exist), `features/<domain>/` for feature UI, `components/` for genuinely shared components (`AGENTS.md` §6.2, §22).
- Depends on: server actions / typed data-access functions.
- Rule: business logic stays out of presentation components (`AGENTS.md` §5 "Frontend rules").

**Application / server (Next.js server primitives):**
- Purpose: request handling, validation, authorization, transactions.
- Intended location: Server Components, Server Actions, Route Handlers inside the Next.js app (does not exist).
- Rule: validate all external input; backend validation is authoritative; keep business rules out of large route handlers (`AGENTS.md` §5 "Backend rules", §13).

**Domain / data-access:**
- Purpose: typed service/data-access functions, business rules, provider-agnostic persistence boundary.
- Intended location: `lib/` + feature-level service modules (`AGENTS.md` §5 "Supabase rules": keep Supabase access in `lib/supabase/` and feature data-access modules).
- Rule: domain layer must not be tightly coupled to Supabase-specific APIs so a future provider migration is possible (`AGENTS.md` §5 "No direct database-platform coupling").

**Persistence (Supabase):**
- Purpose: Postgres storage, auth, RLS tenant isolation, file storage.
- Intended client: `@supabase/ssr` for cookie SSR sessions (does not exist).
- Rule: every tenant-owned table gets deliberate RLS policies; never expose service-role credentials to the browser (`AGENTS.md` §5 "Supabase rules", §7).

## Data Flow

### Current request path

**Not implemented.** There is no HTTP entry point, no route handler, no server action, no client fetch, and no database call anywhere in the repository.

### Intended primary request path (documented intent)

1. Browser hits a Next.js route in the App Router (route tree does not exist).
2. Server Component or Server Action establishes session via `@supabase/ssr` cookies and derives tenant context from authenticated identity + membership — never from request body/query (`AGENTS.md` §7).
3. Input validated with Zod schemas (shared frontend/backend where practical) (`AGENTS.md` §5, §13).
4. Typed data-access/service function executes the query; RLS enforces tenant isolation at the database (`AGENTS.md` §7).
5. Multi-step state changes run in explicit transactions; mutations return typed contracts, never raw DB models (`AGENTS.md` §5 "Backend rules", §11).
6. Side effects (SMS/WhatsApp/email/AI) enqueue idempotent, retry-safe jobs behind provider adapters (`AGENTS.md` §20, §42).

**State management (intended priority, `AGENTS.md` §23):** local React state → URL state → TanStack Query for server state → Zustand only for small genuinely-shared client state. No server state copied into a global client store.

## Key Abstractions

All of the following are documented intent only — no implementations exist:

- **Provider adapters (SMS/WhatsApp/payments/storage/AI):** isolate vendor SDKs behind interfaces so a vendor change is localized (`AGENTS.md` §41; PRD §6 names Gupshup/Twilio/MSG91 as candidate comms providers, Claude API for AI).
- **Data-access/repository boundary:** typed service functions between domain logic and Supabase, preserving portability (`AGENTS.md` §5, §5 "Future portability").
- **Tenant context:** derived server-side from session; the sole source of tenant IDs for queries (`AGENTS.md` §7).
- **Shared validation schemas:** Zod schemas shared between frontend and backend to prevent contract drift (`AGENTS.md` §13).
- **API contract schemas:** explicit request/response types; never return database models directly (`AGENTS.md` §11).
- **Provider abstraction for payments:** financial integrations behind an interface with idempotency keys (`AGENTS.md` §19, §42).

## Entry Points

**Current:** None. No application entry point exists (`src/index.*`, `app/`, `main.*` all absent).

**Intended (documented):**
- Next.js App Router root layout/page — route tree at `app/` (not created).
- Supabase auth callbacks / middleware for session refresh — `lib/supabase/` (not created).
- Route Handlers for API/integrations under `app/api/` (not created) — the PRD (`docs/clinic-management-prd.md` §4.12) also anticipates public API access.
- Health/readiness endpoints (`AGENTS.md` §34) — not created.

## Architectural Constraints

These are binding on all future code (from `AGENTS.md`); none are testable today because no code exists:

- **Threading/concurrency:** single Node.js request model via Next.js; assume concurrent users (two receptionists booking the same slot) — protect with transactions, unique constraints, optimistic locking, idempotency; never rely on "the UI shouldn't allow that" (`AGENTS.md` §43).
- **Global state:** no module-level mutable global state; no browser-global tenant/user caches (`AGENTS.md` §5 "Frontend rules", §23).
- **Multi-tenancy:** tenant isolation enforced server-side + RLS; tenant IDs never trusted from the browser; cross-tenant access must be tested explicitly (`AGENTS.md` §7).
- **Circular imports:** none observed (no code); keep cross-module dependencies intentional and one-directional per `AGENTS.md` §6.1.
- **Framework constraints:** Next.js App Router only (no Vite, no React Router as app router); no SQLite; no second backend framework without a concrete requirement (`AGENTS.md` §5).
- **Design constraint:** `DESIGN.md` is the sole UI authority — light theme only, no gradients, no alternative design system (`AGENTS.md` §3).
- **Sensitive data:** clinical data treated as sensitive by default; no logging of clinical notes/tokens; audit trail required for security-sensitive actions (`AGENTS.md` §9–§10).
- **Git history:** zero commits so far — the first scaffold commit will establish the baseline (`git log` reports no commits on `main`).

## Anti-Patterns

No anti-patterns can be observed in code (there is no code). The following are **documented prohibitions** that must be avoided during scaffolding — treat them as the anti-pattern list for this project:

### Frontend-driven tenant isolation

**What it would be:** filtering patients/appointments by tenant in React components or client query params only.
**Why it's wrong:** leaks cross-tenant data through IDs, search, exports, autocomplete (`AGENTS.md` §7).
**Do this instead:** derive tenant from authenticated session server-side and enforce isolation in RLS policies + server queries (`AGENTS.md` §7, §5 "Supabase rules").

### Scattering vendor SDK calls / raw Supabase coupling

**What it would be:** importing `twilio`, `@supabase/*` client calls, or AI SDKs directly inside components and route handlers.
**Why it's wrong:** vendor change rewrites the domain layer; blocks the documented future provider migration (`AGENTS.md` §5, §41; PRD §6 "Migration considerations").
**Do this instead:** one adapter module per external service; domain code depends on the interface only (`AGENTS.md` §41).

### Giant shared-component directory / nested cards

**What it would be:** dumping every component into a global `components/` folder, or composing Page→Card→Card→Card.
**Why it's wrong:** `AGENTS.md` §22 requires feature-first organization; `DESIGN.md` §34 (Component Hierarchy) forbids nested cards as the default structure.
**Do this instead:** organize by `features/<domain>/`; promote to shared only when genuinely reusable; compose Page→Section→Content (`DESIGN.md` §34, `AGENTS.md` §22).

### Skipping RLS "temporarily"

**What it would be:** creating tenant tables without RLS policies to move faster.
**Why it's wrong:** RLS is a mandatory security boundary for a healthcare multi-tenant product (`AGENTS.md` §5, §31).
**Do this instead:** migration + RLS policy + cross-tenant access test ship together (`AGENTS.md` §7, §27).

### Scaffolding a structure that contradicts `AGENTS.md` §6.2

**What it would be:** inventing an unrelated layout (e.g., `apps/api` Python backend, microservices, monorepo packages) without a concrete requirement.
**Why it's wrong:** §49 forbids speculative complexity; §5 forbids a second backend framework absent justification.
**Do this instead:** follow the §6.2 suggested structure, adapted to what exists (see `STRUCTURE.md` "Where to Add New Code").

## Error Handling

**Current:** Not applicable — no code.

**Documented strategy (`AGENTS.md` §12):**
- User-facing errors state what failed, whether anything was saved, and next step; never stack traces, DB errors, or internal service names.
- Developer-facing: structured logs with request/correlation ID, error type, route, tenant/actor context when safe; consistent HTTP error shape (`AGENTS.md` §11–§12).
- Never log passwords, tokens, cookies, secrets, payment credentials, or clinical content.

## Cross-Cutting Concerns

**Current:** none implemented.

**Documented intent:**
- **Logging:** structured logs + correlation IDs; monitor API errors, latency, auth/notification/payment/storage failures (`AGENTS.md` §33). No logging framework selected yet (see `.planning/codebase/STACK.md`).
- **Validation:** Zod at boundaries; client validation for UX only, server validation authoritative (`AGENTS.md` §13).
- **Authentication:** Supabase Auth via `@supabase/ssr`, short-lived sessions, HttpOnly cookies, Secure/SameSite flags; RBAC roles (Owner, Doctor, Nurse, Receptionist, Billing, Admin) checked server-side (`AGENTS.md` §8).
- **Authorization:** server-side only; UI hiding is not authorization (`AGENTS.md` §8).
- **Audit:** audit events for login, permission changes, patient/consultation/prescription/invoice changes, document access, exports, deletions (`AGENTS.md` §10); PRD §7 lists an `AuditLog` entity.
- **Background jobs:** async, retry-safe, idempotent for email/SMS/WhatsApp/reminders/exports (`AGENTS.md` §20, §42). No queue technology selected yet.

---

*Architecture analysis: 2026-10-06*
