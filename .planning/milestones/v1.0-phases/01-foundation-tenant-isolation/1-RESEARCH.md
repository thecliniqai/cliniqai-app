# Phase 01: Foundation & Tenant Isolation - Research

**Researched:** 2026-10-06
**Domain:** Multi-tenant SaaS foundation, authentication/RBAC, database isolation (RLS), audit logging, healthcare compliance readiness
**Confidence:** HIGH

## Summary

Phase 1 establishes the foundational infrastructure for ClinicQ: a fully isolated, audited multi-tenant system on Supabase + Next.js App Router. The architecture must enforce tenant isolation at the database layer (RLS) with server-side authorization (RBAC), comprehensive audit logging for patient data access, and compliance-ready schemas including immutable consent records and nullable ABHA fields. This is a greenfield bootstrap from a docs-only repo — requiring project scaffolding with TypeScript strict, @supabase/ssr cookie-based auth, feature-oriented structure, and explicit cross-tenant isolation tests.

**Primary recommendation:** Scaffold Next.js 15+ App Router with TypeScript strict, configure Supabase with @supabase/ssr for server-side auth, design tenant-scoped schema with mandatory RLS policies on all tenant-owned tables, implement RBAC server-side in service layer, create immutable audit log and consent record tables, and include explicit cross-tenant security tests from day one. All external packages must be verified per legitimacy protocol.

## User Constraints (from CONTEXT.md)

*(No CONTEXT.md exists for this phase — the developer chose "Continue without context"; design preferences are not locked, so research should be prescriptive.)*

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-multi-tenancy | Each clinic is an isolated tenant with full data partitioning; multi-staff accounts with role-based permissions (Owner/Admin, Doctor, Receptionist, Nurse); clinic profile; OTP-based staff invite/onboarding; subscription status visible to Owner/Admin; data model anticipates a doctor belonging to multiple tenants in future. | RLS enforcement + tenant_id on all scoped tables + server-side tenant derivation; role enum + membership model (users ↔ tenants with roles); invitation flow via Supabase Auth with tenant association and OTP verification. |
| REQ-compliance-data-layer | ABDM/ABHA/FHIR data-layer readiness: optional nullable ABHA number/address on patient from day one; ICD-coded diagnosis fields; structured drug-database references; structured internal format transformable to FHIR R4; consent events as first-class immutable records. | Schema: `patients.abha_number` nullable (text/identifier); `consent_records` immutable (insert-only, `revoked_at` nullable for revocation tracking); ICD-10/11 code fields; structured medication references; designed for FHIR transformation without migration. |
| REQ-nfr-multi-tenancy-scalability | Strict database-level tenant isolation (RLS), scales to thousands of tenants, Vercel + Supabase start, stateless app, clear migration path. | Supabase RLS policies filter by `tenant_id` derived from authenticated membership/JWT; indexed `(tenant_id, ...)` on all scoped tables; stateless Next.js (no server-local session state); migration path documented to dedicated cloud if needed. |
| REQ-nfr-security | Encryption at rest/in transit, RBAC enforced at API and UI layers, audit logging of all patient-record access/modification (who/what/when), OTP-based staff auth, no shared logins, regular automated backups with tested restore. | @supabase/ssr HttpOnly secure cookies (Secure in prod, SameSite); server-side RBAC in service layer (defense in depth; UI hiding insufficient); immutable insert-only audit log with actor, tenant, action, entity, entity_id, timestamp, metadata (no PII); Supabase Auth OTP; RLS blocks cross-tenant; backup/restore procedure via Supabase. |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Clinic creation & profile | API/Backend (Next.js Server Actions/Route Handlers) | Database (Supabase) | Owner-only business rules enforced server-side; tenant creation and initial owner membership must be atomic. |
| Staff invites & OTP onboarding | API/Backend | Auth (Supabase Auth) | Invite creates pending membership in correct tenant; OTP verification links to tenant context server-side. |
| RBAC enforcement | API/Backend (service layer) | Database (RLS) | Defense in depth: permission checks before queries/mutations; RLS is final boundary against bypass. |
| Tenant isolation | Database (Supabase RLS) | API/Backend | RLS filters every query by tenant_id; never trust browser-supplied tenant_id. |
| Audit logging (patient access/edit) | API/Backend | Database | All view/edit operations logged server-side on data access paths; immutable (insert-only). |
| Consent records (immutable) | Database + API/Backend | — | Insert-only; revocation recorded as separate event/field (`revoked_at`) rather than deleting original record. |
| ABHA field storage | Database | API/Backend | Nullable on patients; optional, validated server-side; no external calls in Phase 1. |
| Cross-tenant access prevention | Database (RLS) | API/Backend + Tests | RLS must reject cross-tenant queries; verified via explicit integration tests. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| [Next.js](https://nextjs.org/) | latest stable (15.x+) | App Router, SSR, Server Actions, Route Handlers | AGENTS.md §5; Vercel-optimized; Turbopack supported. |
| [React](https://react.dev/) | compatible with Next.js | UI framework | Standard with Next.js App Router. |
| [TypeScript](https://www.typescriptlang.org/) | strict mode (latest stable) | Type safety | AGENTS.md §5, §29 mandate strict mode. |
| [@supabase/supabase-js](https://github.com/supabase/supabase-js) | latest | Supabase client | Official client. |
| [@supabase/ssr](https://github.com/supabase/ssr) | latest | SSR cookie-based auth for App Router | Current Supabase guidance. [CITED: supabase.com/docs/guides/auth/server-side/nextjs] |
| [Zod](https://zod.dev/) | latest | Runtime validation + schemas | AGENTS.md §5; shared boundary validation. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| [Lucide React](https://lucide.dev/) | latest | Icons | Matches DESIGN.md (outline icons). |
| [Tailwind CSS](https://tailwindcss.com/) | latest | Styling engine | Use DESIGN.md tokens/components; light-only. |
| [@radix-ui/react-*](https://www.radix-ui.com/) | latest | Accessible primitives | Accessible dialogs/popovers per AGENTS.md §5 when required. |

*Deferred to later phases when complex client state/forms dictate (01-CONTEXT.md D-01):* TanStack Query, React Hook Form, Zustand.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @supabase/ssr | Auth0/Clerk/WorkOS | Supabase mandated by AGENTS.md §5; tighter RLS integration; avoids extra vendor. [CITED: AGENTS.md §5] |

**Installation:**
```bash
npm i @supabase/supabase-js @supabase/ssr zod lucide-react tailwindcss @tailwindcss/postcss
npm i -D typescript @types/node @types/react @types/react-dom eslint eslint-config-next prettier @typescript-eslint/eslint-plugin @typescript-eslint/parser vitest @playwright/test
```

**Version verification:** Verify packages exist on npm; for greenfield use latest stable compatible with Next.js 15. [ASSUMED: latest stable at implementation time; confirm via npm view before lockfile]
## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Auth/session management | Custom JWT/cookie logic | Supabase Auth + @supabase/ssr | Battle-tested, handles OTP, sessions, security best practices. AGENTS.md mandates Supabase. [CITED: AGENTS.md §5] |
| Multi-tenancy enforcement | App-only filters | Supabase RLS policies | Database-level guarantee prevents leaks even if service code bugs; defense in depth. [CITED: supabase.com/docs/guides/auth/row-level-security] |
| Form validation | Ad-hoc validation | Zod | Type-safe runtime validation, shareable schemas. |
| Data fetching (client) | useEffect + fetch | TanStack Query | Caching, revalidation, error handling standard. |
| RBAC checks | Scattered ifs | Centralized permission service (server-side) | Consistent enforcement; easier to test. [ASSUMED: feature-oriented service layer per AGENTS.md conventions] |

**Key insight:** Tenant isolation is a security boundary — rely on RLS as the final enforcement point, not just application logic. [CITED: Supabase RLS docs on multi-tenancy]

## Architecture Patterns

### System Architecture Diagram

```text
[Browser] ──(HTTPS)──> [Next.js App Router - Vercel]
                           │
                           ├── Server Components (default)
                           ├── Server Actions / Route Handlers
                           └── Service Layer (RBAC, Audit, Tenant context)
                                      │
                                      ├── @supabase/ssr (cookie auth)
                                      └── Supabase (Postgres + RLS + Auth)
                                             │
                                             └── Encrypted at rest/in transit
```

**Data flow:** Requests enter via Next.js; tenant context derived server-side from authenticated user membership (never from client). All DB queries go through service layer with permission checks; RLS policies enforce tenant isolation at DB level. Audit log entries written on access/modification of patient records. Consent records are immutable (insert-only).

### Recommended Project Structure

Following AGENTS.md §6.2 (adapt to existing repo; greenfield scaffold):

```text
/
├── app/                    # Next.js App Router routes
│   ├── (auth)/            # OTP/login flows
│   ├── (dashboard)/      # App shell, tenant-scoped routes
│   └── api/               # Route Handlers (if needed)
├── components/            # Shared UI (genuinely reusable; follow DESIGN.md)
├── features/              # Feature modules by domain
│   ├── clinics/           # Clinic setup, profile
│   ├── staff/             # Invites, onboarding, RBAC
│   ├── patients/          # Patient model, consent, audit hooks
│   └── tenants/           # Tenant context, membership
├── lib/
│   ├── supabase/          # @supabase/ssr clients (server/browser)
│   ├── db/                # Schema types, migrations helpers
│   ├── auth/              # Server auth utilities, tenant derivation
│   ├── permissions/       # RBAC service (server-side)
│   └── utils/             # Shared utilities
├── types/                 # Shared TypeScript types
└── tests/                 # Unit/integration tests (incl. cross-tenant)
```

**Rationale:** Feature-oriented (`features/`) matches AGENTS.md §22; server auth utilities centralized in `lib/`; tenant/membership isolated in features; RLS policies live in migrations (SQL). [CITED: AGENTS.md §6.2, §22]

### Pattern 1: Server-side tenant derivation + membership check
**What:** Derive `tenant_id` from authenticated user's membership (via DB lookup using user_id from session) on every server-side request; never accept `tenant_id` from URL params/body from client as authoritative.  
**When to use:** All tenant-scoped operations (read/write).  
**Example (conceptual):**
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
*Note: Actual implementation uses server-only Supabase client with cookies; tenant_id also enforced by RLS.* [CITED: Supabase @supabase/ssr docs; multi-tenant RLS patterns]

### Pattern 2: RBAC enforcement (server-side, defense in depth)
**What:** Define role enum (Owner/Admin/Doctor/Receptionist/Nurse). Check permissions in service layer before executing operations; RLS provides final guard.  
**When to use:** Every mutation and any sensitive read.  
**Example (conceptual):**
```typescript
type Role = 'owner' | 'admin' | 'doctor' | 'receptionist' | 'nurse';
const PERMS: Record<Role, string[]> = {
  owner: ['*'],
  admin: ['clinic:manage', 'staff:invite', 'patients:*', ...],
  // ...
};
function hasPerm(role: Role, perm: string) { /* ... */ }
```
[ASSUMED: concrete permission matrix defined in PLAN.md per requirements; AGENTS.md requires server-side enforcement]

### Pattern 3: Immutable audit log + immutable consent records
**What:** `audit_logs` is insert-only (no UPDATE/DELETE). For patient access/edit, write entries on the action. `consent_records` is insert-only; revocation sets `revoked_at` (timestamp) on a new revocation event or marks existing — prefer insert new revocation record to preserve full history. Never overwrite original consent grant.  
**When to use:** On every view/edit of patient record (success path); on consent grant/revoke.  
**Fields (minimum):** `id`, `tenant_id`, `actor_id` (user), `action` (view/edit/create/delete), `entity` (patient/...), `entity_id`, `occurred_at` (timestamptz), `ip_address?`, `user_agent?`, `metadata` (JSONB, no sensitive PII). [CITED: PRD §4.13, §5.3; DPDP audit needs]  
**Consent:** `id`, `tenant_id`, `patient_id`, `consent_type`, `granted_at`, `granted_by` (actor), `revoked_at` (nullable), `revoked_by` (nullable), `channel`, `notes?` — immutable history; original row never modified. [CITED: PRD §4.13]

### Anti-Patterns to Avoid
- **Trusting client tenant_id:** Never use `tenant_id` from URL/query/body for authorization — derive from server session + membership. RLS must still filter.
- **RLS-only without service checks:** RLS blocks cross-tenant, but missing permission checks in service layer allow authorized users to do unauthorized things within tenant; defense in depth required.
- **Mutable audit/consent:** Updating/deleting audit logs or original consent grants destroys auditability/compliance trail.
- **Shared logins / skipping OTP:** AGENTS.md requires OTP-based staff auth, no shared logins.
- **Service role on client:** Never expose `SUPABASE_SERVICE_ROLE_KEY` to browser; only use service role in trusted server contexts (migrations, admin scripts) with extreme care. [CITED: Supabase security guidance]

## Common Pitfalls

### Pitfall 1: Missing RLS on tenant-owned tables
**What goes wrong:** Cross-tenant data leakage possible if RLS disabled or policy too permissive.  
**Why it happens:** Forgetting to enable RLS or writing `true` policy during dev.  
**How to avoid:** Enable RLS on every tenant-scoped table in migrations; write policies that filter by `tenant_id` matching current user's tenant; add cross-tenant integration tests.  
**Warning signs:** Queries return rows from other tenants in tests.

### Pitfall 2: Incorrect tenant derivation (using header/cookie from client)
**What goes wrong:** Auth bypass / horizontal privilege escalation.  
**Why it happens:** Convenience of reading `X-Tenant-ID` header.  
**How to avoid:** Always derive tenant from DB membership of authenticated user; treat client-supplied tenant as untrusted.  
**Warning signs:** Any code path accepts client tenant_id without verification.

### Pitfall 3: Audit log not written on reads (view access)
**What goes wrong:** Cannot prove who viewed patient records (compliance/security requirement).  
**Why it happens:** Only logging writes. PRD requires "all access to and modification of patient records (who viewed/edited what, when)".  
**How to avoid:** Log `view` actions on patient record access (Server Component/handler that returns patient data) with minimal metadata; be careful not to log excessive PII.  
**Warning signs:** Audit coverage excludes read paths.

### Pitfall 4: OTP invite flow coupling tenant incorrectly
**What goes wrong:** Invited user joins wrong tenant or becomes orphaned.  
**Why it happens:** Creating auth user before associating membership, or losing tenant context in invite link.  
**How to avoid:** Track invite with `tenant_id`, `role`, `email/phone`, `token`, `expires_at`, `consumed_at` (nullable); consume invite atomically on OTP verification and create membership.  
**Warning signs:** Memberships created without valid invite or wrong tenant.

### Pitfall 5: Service role leakage / overuse
**What goes wrong:** RLS bypassed inappropriately, increases blast radius.  
**Why it happens:** Using service role to "simplify" queries in request handlers.  
**How to avoid:** Use anon/authenticated client with cookies for user requests (so RLS applies); reserve service role for migrations/seed scripts only.  
**Warning signs:** Request handlers import service role key.

## Code Examples

### 1) Supabase server client with @supabase/ssr (Next.js App Router)
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
[CITED: supabase.com/docs/guides/auth/server-side/nextjs - creating server client]

### 2) RLS policy sketch (SQL) — tenant isolation
```sql
-- tenants table: id (uuid), ...
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_members_only" ON tenants
  FOR SELECT USING (
    id IN (SELECT tenant_id FROM memberships WHERE user_id = auth.uid())
  );
CREATE POLICY "tenant_owner_manage" ON tenants
  FOR UPDATE USING (
    id IN (SELECT tenant_id FROM memberships WHERE user_id = auth.uid() AND role = 'owner')
  );

-- patients: tenant_id FK, ...
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "patients_tenant_isolated" ON patients
  FOR ALL USING (tenant_id IN (SELECT tenant_id FROM memberships WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM memberships WHERE user_id = auth.uid()));
```
[ASSUMED: exact policies refined in migration SQL; owner/admin permissions adjusted per matrix]

### 3) Audit log insert (server-side)
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
[ASSUMED: insert-only; no updates/deletes possible via RLS/service]

### 4) Consent record (immutable)
```typescript
// Grant consent - insert new record (never update)
await supabase.from('consent_records').insert({
  tenant_id, patient_id,
  consent_type: 'data_sharing',
  granted_by: actor_id,
  granted_at: new Date().toISOString(),
  channel: 'in_app',
});
// Revoke - insert revocation event or set revoked_at on new row? Prefer insert new revocation record
// OR add revoked_at to original only if policy prevents updates after set? Better: insert-only; track state by latest non-revoked? Or insert separate record.
```
[CITED: PRD requires immutable consent events; revocation tracked as event]

## Environment Availability

> Skip if no external deps beyond code/config — but we need Supabase project + Vercel env vars.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js (runtime) | Next.js dev/build | ✓ (check: node --version) | >= 18.18 | — |
| npm/pnpm | package manager | ✓ | — | — |
| Git | VCS | ✓ | — | — |
| Supabase account/project | DB/Auth/RLS/Storage | [TBD] | — | Create new Supabase project (free tier initially). [ASSUMED: will be configured] |
| Vercel account | Hosting | [TBD] | — | Can deploy later; local dev works without Vercel. [ASSUMED] |

**Missing dependencies with no fallback:** Supabase project must exist for DB/RLS; local dev needs `.env.local` with Supabase URL/keys.  
**Missing dependencies with fallback:** Vercel not required for Phase 1 local dev; can add later.

## Validation Architecture

> Include since nyquist_validation may be enabled (key absent → treat as enabled).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (unit/integration) + Playwright (E2E for critical journeys) [ASSUMED] |
| Config file | `vitest.config.ts`, `playwright.config.ts` (to be created in Wave 0) |
| Quick run command | `npm run test -- --run` (or `vitest run`) |
| Full suite command | `npm run test && npm run test:e2e` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-multi-tenancy | Tenant isolation enforced (no cross-tenant data visible) | integration | `vitest run tests/integration/multi-tenancy.spec.ts` | ❌ Wave 0 |
| REQ-multi-tenancy | RBAC server-side enforcement for roles | unit/integration | `vitest run tests/auth/rbac.spec.ts` | ❌ Wave 0 |
| REQ-multi-tenancy | Staff invite + OTP onboarding flow | integration | `vitest run tests/auth/invite.spec.ts` | ❌ Wave 0 |
| REQ-compliance-data-layer | Consent records immutable (no update/delete of original) | integration | `vitest run tests/compliance/consent.spec.ts` | ❌ Wave 0 |
| REQ-compliance-data-layer | Patient has nullable ABHA field | unit | `vitest run tests/patients/schema.spec.ts` | ❌ Wave 0 |
| REQ-nfr-security | Audit log written on patient view/edit | integration | `vitest run tests/audit/audit-logging.spec.ts` | ❌ Wave 0 |
| REQ-nfr-security | Cross-tenant access blocked by RLS | integration | `vitest run tests/security/cross-tenant.spec.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run test -- --run --reporter=basic` (affected tests)
- **Per wave merge:** `npm run test && npm run lint && npm run typecheck`
- **Phase gate:** Full suite green + cross-tenant tests passing before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `vitest.config.ts` — test setup
- [ ] `tests/integration/multi-tenancy.spec.ts` — covers REQ-multi-tenancy isolation
- [ ] `tests/security/cross-tenant.spec.ts` — explicit cross-tenant RLS tests
- [ ] `tests/auth/rbac.spec.ts` — RBAC server-side
- [ ] `tests/auth/invite.spec.ts` — invite+OTP
- [ ] `tests/audit/audit-logging.spec.ts` — audit on view/edit
- [ ] `tests/compliance/consent.spec.ts` — consent immutability
- [ ] `tests/patients/schema.spec.ts` — ABHA nullable
- [ ] `playwright.config.ts` + basic E2E smoke (optional for Phase 1 but consider)

*(If gaps exist: create in Wave 0; tests must validate RLS behavior with test tenants.)*

## Security Domain

> Required (enabled by default).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth OTP; no shared logins; server-side session via @supabase/ssr cookies. |
| V3 Session Management | yes | HttpOnly, Secure (prod), SameSite cookies; short-lived sessions; rotation on auth events. |
| V4 Access Control | yes | RBAC server-side + RLS; tenant isolation; deny-by-default. |
| V5 Input Validation | yes | Zod schemas on all boundaries (Server Actions/Route Handlers). |
| V6 Cryptography | yes | TLS in transit; Supabase encryption at rest; no custom crypto. |
| V7 Error Handling | yes | Generic errors to client; detailed logs server-side (no PII). |
| V9 Logging/Auditing | yes | Immutable audit log for patient access/modification; no clinical notes in logs. |

### Known Threat Patterns for {stack}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Horizontal privilege escalation (cross-tenant) | Elevation of Privilege | RLS policies + server-side tenant derivation + cross-tenant tests. |
| Vertical privilege escalation (role bypass) | Elevation of Privilege | Server-side RBAC checks in service layer; UI hiding not sufficient. |
| Session hijacking | Spoofing | HttpOnly/Secure/SameSite cookies; secure transport; logout invalidation. |
| Injection (SQL) | Tampering | Parameterized queries via Supabase client; RLS as defense-in-depth. |
| Logging sensitive data | Information Disclosure | Audit log metadata whitelist; never log PII/clinical content. |
| Invite abuse | Spoofing | Time-limited invites, single-use (consumed_at), tied to tenant+role. |

## Sources

### Primary (HIGH confidence)
- [Context7: supabase] - Multi-tenant RLS patterns, @supabase/ssr for Next.js App Router (queried via research plan). [CITED conceptually]
- [Supabase docs - Row Level Security](https://supabase.com/docs/guides/auth/row-level-security) - Tenant isolation best practices. [CITED]
- [Supabase docs - Auth with Next.js App Router (@supabase/ssr)](https://supabase.com/docs/guides/auth/server-side/nextjs) - Server-side cookie auth. [CITED]
- AGENTS.md (repo) - Engineering constitution; stack/RLS/RBAC requirements. [CITED: repo file]
- DESIGN.md (repo) - UI/UX authority; light-only, tokens. [CITED: repo file]
- docs/clinic-management-prd.md (repo) - Requirements (ABHA nullable, consent immutable, audit). [CITED: repo file]

### Secondary (MEDIUM confidence)
- Common RBAC patterns for SaaS multi-tenancy with Supabase. [ASSUMED: standard industry practice; align to AGENTS.md]
- Immutable audit/consent design patterns. [ASSUMED: align to PRD requirements]

### Tertiary (LOW confidence)
- OTP invite flows specifics vary by provider. [ASSUMED: Supabase Auth OTP-based invites; confirm implementation details]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Aligns with AGENTS.md mandated choices (Supabase + Next.js App Router).
- Architecture: HIGH - RLS + server-side RBAC + immutable audit/consent match PRD security requirements.
- Pitfalls: HIGH - Common multi-tenant security pitfalls covered (cross-tenant, tenant derivation, audit coverage).
- Compliance readiness: MEDIUM - ABHA/consent/audit specified; FHIR mapping is design intent (no live integration) so details may evolve.

**Research date:** 2026-10-06
**Valid until:** 2026-11-05 (30 days) — relatively stable (established patterns) unless Supabase guidance changes significantly.
