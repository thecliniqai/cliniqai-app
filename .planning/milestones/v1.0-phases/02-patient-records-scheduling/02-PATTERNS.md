# Phase 2: Patient Records & Scheduling - Codebase Patterns

**Date:** 2026-10-07  
**Status:** Complete  

---

## 1. Existing Architectural Patterns

### 1.1 Data Access & Multi-Tenancy Boundary
- **Tenant Context Resolution:** Every mutation and tenant-scoped query resolves tenant identity server-side via `getActiveMembership()` in `lib/auth/tenant.ts`. Never trust client-supplied tenant IDs.
- **Server Actions Pattern:** Located in `features/<module>/actions.ts`.
  ```ts
  "use server";
  import { getActiveMembership } from "@/lib/auth/tenant";
  import { createClient } from "@/lib/supabase/server";
  import { recordAudit } from "@/lib/audit/audit";
  ```
- **Auditing Pattern:** Every clinical and intake modification logs to `public.audit_logs` via `recordAudit({ action, entityType, entityId, metadata })`.

### 1.2 Database & RLS Conventions
- **Migrations:** Sequential SQL scripts in `supabase/migrations/`.
- **Row Level Security:**
  - `ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY;`
  - Explicit `SELECT`, `INSERT`, `UPDATE`, `DELETE` policies scoping to `tenant_id IN (SELECT current_user_tenant_ids())`.
  - Composite indexes on `(tenant_id, ...)` for all filtered and ordered columns.

### 1.3 UI & Design System Conventions
- **Single Source of Truth:** `DESIGN.md`.
- **Tokens:** CSS variables for color, radius, and elevation (`var(--radius-md)`, `var(--color-brand)`, `var(--text-primary)`, `var(--surface-default)`).
- **Touch Ergonomics:** Minimum 44px hit targets on interactive controls (`min-h-[44px]`).
- **Progressive Disclosure:** Use slide-out drawers / bottom sheets for contextual intake without navigating away from the active screen.

---

## 2. Analog Mapping for Phase 2 Files

| New Phase 2 File | Closest Existing Analog | Pattern to Mirror |
|------------------|-------------------------|-------------------|
| `supabase/migrations/000006_appointments_queue_waitlist.sql` | `supabase/migrations/000003_patients_audit_consent.sql` | UUID PK, tenant FK, RLS policies, index design, security definer RPC |
| `features/visits/actions.ts` | `features/patients/actions.ts` | Server Actions, membership check, audit logging, input validation |
| `features/patients/dedup.ts` | `features/patients/consent.ts` | Clean domain service, deterministic ordering, pure business logic |
| `features/queue/actions.ts` | `features/staff/actions.ts` | State transition mutations, authorization checks |
| `app/(dashboard)/queue/page.tsx` | `app/(dashboard)/patients/page.tsx` | Server component page, search bar, list with empty states |
| `app/(dashboard)/calendar/page.tsx` | `app/(dashboard)/staff/page.tsx` | Header controls, high-density layout, action drawers |
| `tests/integration/visits.spec.ts` | `tests/integration/multi-tenancy.spec.ts` | Seeding helpers, cross-tenant isolation verification |
| `tests/patients/dedup.spec.ts` | `tests/patients/schema.spec.ts` | Fast deterministic unit tests with edge-case matrices |
