# Phase 1: Foundation & Tenant Isolation - Pattern Map

**Mapped:** 2026-10-06
**Files analyzed:** ~40 (new files/families extracted from `1-RESEARCH.md`)
**Analogs found:** 0 / 40 — **greenfield repo, no application source code exists**

> **Repo state (verified this session):** Documentation-only. `git ls-files` returns 21 tracked files, all under `.planning/`. There is no `package.json`, `tsconfig.json`, `src/`, `app/`, `lib/`, `features/`, `tests/`, `migrations/`, or any `*.ts/tsx/js` product file anywhere in the tree. Globs for `src/**/*` and `**/{package.json,tsconfig.json,vitest.config.*,next.config.*,*.config.ts}` returned zero matches. Consequently **no codebase analog exists for any file in this phase.**
>
> **Tracked-source gate:** vacuously satisfied — no analog paths are named from disk. The only JavaScript in the repo is vendored GSD tooling under `.opencode/`, which `.planning/codebase/CONVENTIONS.md` (line 9) explicitly forbids as a style reference: *"that is tooling infrastructure, not product code, and must not be treated as a style reference for the application."* Do not copy patterns from `.opencode/**`.
>
> **Pattern sources for this phase** (in priority order):
> 1. `1-RESEARCH.md` — Code Examples 1–4, Patterns 1–3, Pitfalls (concrete, cited code — quoted below)
> 2. `AGENTS.md` — engineering contract (§5 stack, §7 multi-tenancy, §12 errors, §13 validation, §27 testing, §28 verification, §29 type safety, §32 secrets)
> 3. `DESIGN.md` — binding UI/visual contract (§2 non-negotiables, §5.1 core tokens, §41)
> 4. Official Supabase docs (cited in RESEARCH: `@supabase/ssr` Next.js guide, RLS guide)

---

## File Classification

| # | New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|-------------------|------|-----------|----------------|---------------|
| 1 | `package.json` | config | scaffold | — | no analog → RESEARCH "Standard Stack" (L39–71) |
| 2 | `tsconfig.json` (strict) | config | scaffold | — | no analog → AGENTS.md §5/§29 |
| 3 | `next.config.ts` + Tailwind/PostCSS/ESLint/Prettier configs | config | scaffold | — | no analog → RESEARCH Standard Stack; CONVENTIONS.md "Code Style" |
| 4 | `.env.example` | config | scaffold | — | no analog → AGENTS.md §32; RESEARCH "Environment Availability" (L298–311) |
| 5 | `vitest.config.ts` | config | scaffold | — | no analog → RESEARCH L319–323 [ASSUMED Vitest] |
| 6 | `playwright.config.ts` | config | scaffold | — | no analog → AGENTS.md §27/§48 |
| 7 | `lib/supabase/server.ts` | config (client factory) | request-response | — (external: Supabase docs) | no analog → RESEARCH Code Example 1 (L214–240) |
| 8 | `lib/supabase/client.ts` (browser) | config (client factory) | request-response | — (external: Supabase docs) | no analog → RESEARCH structure L121 ("server/browser") |
| 9 | `middleware.ts` (session refresh) | middleware | request-response | — (external: @supabase/ssr pattern) | no analog → *implied by stack, not specified in RESEARCH — low confidence* |
| 10 | `lib/auth/tenant.ts` (tenant derivation) | utility (auth) | request-response | — | no analog → RESEARCH Pattern 1 (L131–150) |
| 11 | `lib/permissions/` (RBAC service) | service | request-response (guard) | — | no analog → RESEARCH Pattern 2 (L152–165) |
| 12 | `lib/audit/audit.ts` (`logAudit`) | service | event-driven (append-on-access) | — | no analog → RESEARCH Code Example 3 (L263–281) |
| 13 | `lib/db/` (schema types/migration helpers) | model (types) | transform | — | no analog → RESEARCH structure L122 |
| 14 | `lib/utils/` | utility | transform | — | no analog → RESEARCH structure L124 |
| 15 | `supabase/migrations/*` (tables + RLS policies) | migration | batch/DDL | — | no analog → RESEARCH Code Example 2 (L242–261); AGENTS.md §14/§38 |
| 16 | `features/clinics/*` (clinic creation/profile — Server Actions) | controller | request-response / CRUD | — | no analog → RESEARCH Arch Responsibility Map (L30) + Patterns 1–2 |
| 17 | `features/staff/*` (invites + OTP onboarding — Server Actions) | controller + service | request-response (workflow) | — | no analog → RESEARCH Pitfall 4 (L200–210) invite schema |
| 18 | `features/patients/*` (consent service, ABHA field handling) | service | CRUD (insert-only) | — | no analog → RESEARCH Code Example 4 (L283–296) |
| 19 | `features/tenants/*` (tenant context, membership) | service | request-response | — | no analog → RESEARCH Pattern 1 (L131–150) |
| 20 | `types/` + per-feature Zod schemas | validation | transform | — | no analog → AGENTS.md §13; RESEARCH Standard Stack (Zod) |
| 21 | `app/(auth)/*` (OTP/login pages) | component (page) | request-response | — | no analog → DESIGN.md (§2, §5.1) is the pattern authority |
| 22 | `app/(dashboard)/*` (shell, clinic setup, staff invite screens) | component (page) | request-response | — | no analog → DESIGN.md; VALIDATION.md manual check (L75) |
| 23 | `components/*` (shared UI) | component | — | — | no analog → DESIGN.md §41.2 "Reuse Before Creating" |
| 24 | `tests/integration/multi-tenancy.spec.ts` | test | integration | — | no analog → RESEARCH L328; VALIDATION.md task 1-01-01 |
| 25 | `tests/security/cross-tenant.spec.ts` | test | integration | — | no analog → RESEARCH L334; VALIDATION.md task 1-01-07 |
| 26 | `tests/auth/rbac.spec.ts` | test | unit/integration | — | no analog → RESEARCH L329; VALIDATION.md task 1-01-02 |
| 27 | `tests/auth/invite.spec.ts` | test | integration | — | no analog → RESEARCH L330; VALIDATION.md task 1-01-03 |
| 28 | `tests/audit/audit-logging.spec.ts` | test | integration | — | no analog → RESEARCH L333; VALIDATION.md task 1-01-06 |
| 29 | `tests/compliance/consent.spec.ts` | test | integration | — | no analog → RESEARCH L331; VALIDATION.md task 1-01-05 |
| 30 | `tests/patients/schema.spec.ts` | test | unit | — | no analog → RESEARCH L332; VALIDATION.md task 1-01-04 |
| 31 | `tests/` fixtures (test tenants/seed) | test utility | batch (seed) | — | no analog → RESEARCH L352 ("validate RLS behaviour with test tenants") |

**Counts:** 31 rows ≈ ~40 files/families · exact analogs: 0 · role-match analogs: 0 · no analog: 31 rows (all)

---

## Pattern Assignments

Since no analogs exist, each assignment cites the **concrete, cited code in `1-RESEARCH.md`** (the pattern source for this phase) plus the governing AGENTS.md/DESIGN.md sections. Excerpts below are quotable directly into PLAN.md actions.

### 1. Scaffold & config files (`package.json`, `tsconfig.json`, configs, `.env.example`)

**Pattern source:** `1-RESEARCH.md` "Standard Stack" (L39–71) + AGENTS.md §5, §29, §32.

Installation block (RESEARCH L65–69 / 01-CONTEXT.md D-01):
```bash
npm i @supabase/supabase-js @supabase/ssr zod lucide-react tailwindcss @tailwindcss/postcss
npm i -D typescript @types/node @types/react @types/react-dom eslint eslint-config-next prettier @typescript-eslint/eslint-plugin @typescript-eslint/parser vitest @playwright/test
```
- `tsconfig.json`: **strict mode mandatory** (AGENTS.md §5, §29; RESEARCH L46).
- `.env.example`: commit non-sensitive defaults only; never commit `.env` with secrets (AGENTS.md §32). Required vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only), `SUPABASE_ACCESS_TOKEN`.
- Testing: Vitest for unit/integration + Playwright for E2E critical journeys (AGENTS.md §27/§48; 01-CONTEXT.md D-03).

### 2. `lib/supabase/server.ts` (server client factory)

**Pattern source:** RESEARCH Code Example 1 (L214–240), cited from Supabase's official Next.js SSR guide.
```typescript
// lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch { /* ignore in Server Components */ }
        },
      },
    }
  );
}
```
**Rules:** anon/authenticated cookie clients only in request paths so RLS applies; service role reserved for migrations/seed scripts (RESEARCH Pitfall 5, L206–210). Supabase access centralized in `lib/supabase/` (AGENTS.md §5).

### 3. `lib/auth/tenant.ts` — server-side tenant derivation (applies to ALL server paths)

**Pattern source:** RESEARCH Pattern 1 (L131–150).
```typescript
// Server Action/Server Component (server-side only)
async function getTenantIdForCurrentUser(): Promise<string> {
  const supabase = createServerClient(...); // @supabase/ssr
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthenticated');
  const { data: membership } = await supabase
    .from('memberships')
    .select('tenant_id, role')
    .eq('user_id', user.id)
    .single();
  if (!membership) throw new Error('No tenant membership');
  return membership.tenant_id;
}
```
**Anti-pattern (RESEARCH L174, Pitfall 2):** never use `tenant_id` from URL/query/header/body as authoritative — derive from DB membership of the authenticated user. RLS still filters as final boundary (AGENTS.md §7).

### 4. `lib/permissions/` — RBAC service (server-side, defense in depth)

**Pattern source:** RESEARCH Pattern 2 (L152–165).
```typescript
type Role = 'owner' | 'admin' | 'doctor' | 'receptionist' | 'nurse';
const PERMS: Record<Role, string[]> = {
  owner: ['*'],
  admin: ['clinic:manage', 'staff:invite', 'patients:*', ...],
  // ...
};
function hasPerm(role: Role, perm: string) { /* ... */ }
```
Check permissions in the service layer before every mutation and sensitive read; RLS is the final guard (RESEARCH L154; AGENTS.md §8: "UI hiding is not authorization"). Concrete permission matrix `[ASSUMED]` to be defined in PLAN.md (RESEARCH L165).

### 5. `lib/audit/audit.ts` — immutable audit log (append-on-access)

**Pattern source:** RESEARCH Code Example 3 (L263–281) + Pattern 3 (L167–171).
```typescript
async function logAudit(entry: {
  tenantId: string; actorId: string; action: string;
  entity: string; entityId: string; metadata?: Record<string, unknown>;
}) {
  const supabase = await createClient();
  await supabase.from('audit_logs').insert({
    tenant_id: entry.tenantId,
    actor_id: entry.actorId,
    action: entry.action,
    entity: entry.entity,
    entity_id: entry.entityId,
    metadata: entry.metadata ?? {},
    occurred_at: new Date().toISOString(),
  });
}
```
Minimum fields (RESEARCH L170): `id`, `tenant_id`, `actor_id`, `action` (view/edit/create/delete), `entity`, `entity_id`, `occurred_at`, `ip_address?`, `user_agent?`, `metadata` (JSONB, **no sensitive PII**). Insert-only — no UPDATE/DELETE. Must fire on **reads too** (Pitfall 3, L194–198). Never log clinical notes/tokens/PII (AGENTS.md §9, §33).

### 6. `features/patients/*` — immutable consent records

**Pattern source:** RESEARCH Code Example 4 (L283–296) + Pattern 3 (L171).
```typescript
// Grant consent - insert new record (never update)
await supabase.from('consent_records').insert({
  tenant_id, patient_id,
  consent_type: 'data_sharing',
  granted_by: actor_id,
  granted_at: new Date().toISOString(),
  channel: 'in_app',
});
```
Fields (RESEARCH L171): `id`, `tenant_id`, `patient_id`, `consent_type`, `granted_at`, `granted_by`, `revoked_at` (nullable), `revoked_by` (nullable), `channel`, `notes?`. Revocation = separate insert/event; original grant row never modified (RESEARCH L168).

### 7. `supabase/migrations/*` — schema + RLS policies

**Pattern source:** RESEARCH Code Example 2 (L242–261); AGENTS.md §14, §38.
```sql
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_members_only" ON tenants
  FOR SELECT USING (
    id IN (SELECT tenant_id FROM memberships WHERE user_id = auth.uid())
  );
CREATE POLICY "tenant_owner_manage" ON tenants
  FOR UPDATE USING (
    id IN (SELECT tenant_id FROM memberships WHERE user_id = auth.uid() AND role = 'owner')
  );

ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "patients_tenant_isolated" ON patients
  FOR ALL USING (tenant_id IN (SELECT tenant_id FROM memberships WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM memberships WHERE user_id = auth.uid()));
```
Rules: enable RLS on **every** tenant-scoped table (Pitfall 1, L182–186); indexed `(tenant_id, ...)` on scoped tables (REQ-nfr-multi-tenancy-scalability); `audit_logs` + `consent_records` insert-only enforced via RLS `FOR INSERT` policies; `patients.abha_number` nullable from day one; explicit migration files, review generated SQL (AGENTS.md §38).

### 8. `features/staff/*` — invite + OTP onboarding

**Pattern source:** RESEARCH Pitfall 4 (L200–210).
Invite tracking fields: `tenant_id`, `role`, `email/phone`, `token`, `expires_at`, `consumed_at` (nullable). Consume the invite **atomically** on OTP verification, then create membership — membership must never be created without a valid, unconsumed invite bound to the correct tenant (L203–204). Time-limited, single-use, tied to tenant+role (Security Domain, L377). Uses Supabase Auth OTP — do not hand-roll auth (RESEARCH "Don't Hand-Roll" L76).

### 9. UI files (`app/(auth)`, `app/(dashboard)`, `components/*`)

**Pattern source:** `DESIGN.md` — binding (AGENTS.md §3: DESIGN.md wins for all UI/UX). Key excerpts:
- §5.1 Core Tokens (DESIGN.md L297–356): `colors.brand.primary: #1769E0` (canonical product blue — never arbitrary Tailwind blues), `canvas.default: #F7F6F3`, `border.focus: #1769E0`, semantic state colors (`success: #18794E`, `warning: #9A5B00`, …).
- §2 Non-Negotiables: light theme only, no decorative gradients, one structural accent, cards are not the default container, one primary action per view.
- §41.2 Reuse Before Creating; §41.3 No Arbitrary Visual Values (4px spacing scale, radius tokens, pill reserved for status badges).
- Every reusable component: state set `default/hover/focus/active/disabled/loading/error/empty` (AGENTS.md §29 + DESIGN.md §41.8); mobile is first-class (AGENTS.md §26).
Forms (clinic setup, staff invite): React Hook Form + Zod (RESEARCH L56–57); fewer initially-visible fields, grouped related fields (AGENTS.md §15).

### 10. Test files (`tests/**`)

**Pattern source:** RESEARCH "Validation Architecture" (L313–352) + `01-VALIDATION.md` task map + AGENTS.md §27.
- Framework: **Vitest** (unit/integration) `[ASSUMED]` + Playwright (E2E, optional Phase 1) — confirm in Wave 0.
- Commands: quick `npx vitest run <file>`; wave gate `npm run test && npm run lint && npm run typecheck` (VALIDATION.md L32–34).
- All integration tests must validate RLS behaviour **with test tenants** (RESEARCH L352): seed two tenants, assert cross-tenant reads return zero rows, assert RBAC denials server-side, assert audit rows written on patient view, assert consent immutability (UPDATE/DELETE rejected).
- Backend tests use isolated Supabase/Postgres test env or mocks at the repository boundary — **no SQLite** (AGENTS.md §5).

---

## Shared Patterns

### A. Server tenant derivation (defense layer 1)
**Source:** RESEARCH Pattern 1 (L131–150) · **Apply to:** every Server Action, Route Handler, and Server Component that touches tenant data (rows 16–19)
Derive `tenant_id` from authenticated membership; never trust client-supplied tenant identifiers.

### B. RBAC guard (defense layer 2)
**Source:** RESEARCH Pattern 2 (L152–165) · **Apply to:** all service-layer mutations and sensitive reads (rows 11, 16–19)
Centralized `hasPerm(role, perm)`; UI hiding is never authorization (AGENTS.md §8).

### C. RLS as final boundary (defense layer 3)
**Source:** RESEARCH Code Example 2 (L242–261) · **Apply to:** every tenant-owned table in migrations (row 15)
RLS enabled on all scoped tables; cross-tenant rejection proven by `tests/security/cross-tenant.spec.ts`.

### D. Audit logging on patient access
**Source:** RESEARCH Code Example 3 + Pattern 3 (L167–181, L263–281) · **Apply to:** any code path that returns or mutates patient data (rows 12, 16–18)
Insert-only; log `view` actions on reads; metadata whitelist, no PII/clinical content.

### E. Boundary validation with Zod
**Source:** AGENTS.md §13; RESEARCH "Don't Hand-Roll" (L78) · **Apply to:** all Server Actions / Route Handlers / form schemas (rows 16–21)
Shared schemas frontend/backend where practical; backend validation is authoritative; client validation is UX only.

### F. Two-audience error handling
**Source:** AGENTS.md §12 (+ CONVENTIONS.md "Error Handling") · **Apply to:** all service/controller files (rows 10–12, 16–19)
User-facing: what failed, whether anything saved, what to do next — never stack traces/DB errors/internal names. Developer-facing: structured logs with correlation ID, error type, route/action, tenant/actor context when safe. Never log passwords/tokens/cookies/clinical content.

### G. DESIGN.md token compliance (all UI)
**Source:** DESIGN.md §2, §5.1, §7, §8, §41 · **Apply to:** rows 21–23 (every UI file)
Light-only; `#1769E0` canonical blue; tokenized spacing/radius/colors; reuse-before-creating; no arbitrary values; accessibility + mobile-first per AGENTS.md §25–26.

### H. Secrets & config
**Source:** AGENTS.md §32; RESEARCH Pitfall 5 (L206–210) · **Apply to:** rows 4, 7, 8, 15
`.env.example` committed; no secrets in git; service-role key never imported by request handlers or shipped to browser.

---

## No Analog Found

**Every file in this phase has no codebase analog.** Grouped with the pattern source the planner should use instead:

| File Group | Role | Data Flow | Reason | Use Instead |
|------------|------|-----------|--------|-------------|
| Scaffold configs (`package.json`, `tsconfig.json`, `next/tailwind/eslint/prettier` configs) | config | scaffold | No `package.json`/configs exist anywhere in repo | RESEARCH "Standard Stack" L39–71; CONVENTIONS.md "Code Style" |
| `.env.example` | config | scaffold | Never created | AGENTS.md §32; RESEARCH L298–311 |
| `lib/supabase/*` client factories | config | request-response | No `lib/` tree exists | RESEARCH Code Example 1; official `@supabase/ssr` docs |
| `middleware.ts` | middleware | request-response | Not specified in RESEARCH; standard @supabase/ssr session-refresh only | Supabase Next.js SSR docs — mark low confidence in plan |
| `lib/auth/`, `lib/permissions/`, `lib/audit/`, `lib/db/`, `lib/utils/` | service/utility | request-response / event-driven | No `lib/` tree exists | RESEARCH Patterns 1–3, Code Examples 3–4 |
| `supabase/migrations/*` (schema + RLS) | migration | batch/DDL | No migrations exist | RESEARCH Code Example 2; AGENTS.md §14/§38 |
| `features/clinics|staff|patients|tenants/*` | controller/service | CRUD / request-response | No `features/` tree exists | RESEARCH Arch Responsibility Map + Patterns 1–2 + Pitfall 4 |
| `types/` + Zod schemas | validation | transform | No source exists | AGENTS.md §13; RESEARCH stack (Zod) |
| `app/(auth)`, `app/(dashboard)`, `components/*` | component | request-response | No UI exists | DESIGN.md §2/§5.1/§41 (binding authority) |
| `tests/**` (7 spec files + fixtures) | test | unit / integration | Zero tests exist (TESTING.md, verified) | RESEARCH L313–352; 01-VALIDATION.md task map; AGENTS.md §27 |

---

## Metadata

**Analog search scope:** full-tree scan of `/Users/sid/Code/clinicOS` (excluding `.git/`); globs `src/**/*`, `**/{package.json,tsconfig.json,vitest.config.*,next.config.*,*.config.ts}`, `**/{controllers,services,components,lib,features,app,migrations,tests}/**`; `git ls-files` (21 files, all `.planning/**`); reads of `1-RESEARCH.md`, `01-VALIDATION.md`, `.planning/codebase/{CONVENTIONS,ARCHITECTURE,STRUCTURE,TESTING}.md`, `DESIGN.md` §5.1.
**Files scanned:** 21 tracked files, **0 source files**
**Pattern extraction date:** 2026-10-06
**Gate check:** no mirror/gitignored paths emitted as analogs (none exist); `.opencode/**` explicitly excluded as a style reference per CONVENTIONS.md L9.
