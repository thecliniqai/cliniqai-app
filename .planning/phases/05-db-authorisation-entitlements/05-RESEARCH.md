# Phase 05 (V2-05): Database authorisation, integrity & entitlements - Research

**Researched:** 2026-11-13
**Domain:** Postgres/Supabase RLS (role-aware), referential integrity, Postgres-native concurrency primitives, SaaS entitlement schema, pgTAP
**Confidence:** HIGH for the current-state inventory (live catalogue of the local stack plus migration files); HIGH for the Postgres mechanics (probed on the local PG 17.11); MEDIUM for the proposed role matrix and the CTO rulings (derived from the approved docs, some need PO confirmation)

## Summary

V2-05 turns the database into the last line of defence. Today every tenant table has RLS on, but every policy is **tenant-only**: 25 of the 33 tenant-scoped tables admit any member of the tenant through `tenant_id IN (SELECT current_user_tenant_ids())`, and the other 8 hard-code an `EXISTS (... role IN ('owner','admin'))` check. No policy knows a role permission, a membership status or a subscription state. No parent table has `UNIQUE (tenant_id, id)`, so all 30-odd child references are single-column FKs, and most clinical and financial children `ON DELETE CASCADE` from `patients` and `visits`. pgTAP is available in the local image but **not set up**. The two SQL files in `supabase/tests/` are plain psql scripts, and they make `supabase test db` fail as it stands. There are no subscription, entitlement, platform or AI-gating tables. The v1 `subscriptions`/`payment_records` tables are placeholders.

Three findings change how the work should be planned:

1. **The acceptance "receptionist PostgREST read of `clinical_notes` is denied" has no table to act on.** `clinical_notes` is a **column** on `visits` (and on the dead `consultations` table). Receptionists must read `visits` rows for the front desk, and column privileges cannot tell app roles apart because every user is the `authenticated` Postgres role. A vertical split into a separate RLS-gated table is required. That is a schema change, so it needs a CTO ruling and PO acknowledgement.
2. **The documented exclusion-constraint expression does not compile.** `timestamptz + interval` is STABLE, and Postgres rejects it in an index or exclusion expression. Exclusion constraints also cannot be `NOT VALID`. Both were verified on the local stack, and a working pattern is given below.
3. **SUB-02 locks every tenant without a `tenant_subscriptions` row.** All 47 DB test files seed tenants through `tests/helpers/tenants.ts`, which inserts into `tenants` directly (`:66-70`), not through `create_clinic_with_owner`. One helper change plus `scripts/seed-local-dev.ts` covers almost everything, but it must land **before** enforcement.

**Primary recommendation:** split into **05a** (05-01 → 05-03 → 05-04 → 05-02 → 05-06 → 05-08) and **05b** (05-09 → 05-05 → 05-07 → 05-10). Build the RLS helpers in 05-01 as a small `authz` layer with **stable signatures**, and make every policy call them. 05-05 (membership status) and 05-10 (access level) then change only helper bodies and never rewrite policies.

## Project Constraints (from CLAUDE.md)

- Sources of truth: `docs/v2/V2_MASTER_ROADMAP.md`, `VERIFICATION_LOG.md`, `TARGET_ARCHITECTURE.md`, `ARCHITECTURE_DECISIONS.md`, `docs/adr/`, `SUBSCRIPTIONS_AND_PLANS.md`, `AI_STRATEGY.md`, `AUTH_REDESIGN.md`. **If a task conflicts with an approved decision, STOP and raise it with the PO. Never silently change architecture, requirements, schema or design.** This applies to the clinical-notes split, the permission-key additions and the SUB-01 table subset below.
- Stack: Next.js 15 App Router, React 19, TS strict, Tailwind v4, Supabase via `@supabase/ssr`, zod, Vitest, Playwright.
- Every tenant table has `tenant_id` and RLS. No service-role client in request paths unless the approved plan says so. Every server action or route authenticates, checks permission, and derives the tenant from the session.
- No PHI or secrets in logs, fixtures, prompts, commits or docs. Synthetic data only. Never read or print `.env*`. Never run against hosted Supabase. Local stack only (`npx supabase start -x studio,edge-runtime,logflare,vector,imgproxy,supavisor`, `npx supabase db reset --local`). Never `--linked`, never `db push`.
- Schema changes only through **new** files in `supabase/migrations/` (expand → migrate → contract). Never edit an applied migration. No destructive SQL against any shared DB.
- Background jobs are idempotent and claim work atomically.
- **No new dependency without stating why in the plan.** This research recommends **none** (pgTAP and `btree_gist` are Postgres extensions in the Supabase image, not npm packages).
- Definition of done: tests assert real outcomes; typecheck, lint and tests green; CI green with 0 retried tests; UI at 360px, tablet and desktop with axe clean (applies to the functional `/billing/locked` pages); evidence produced by tools (`scripts/phase-evidence.mjs`); an isolated reviewer plus an **adversarial second review** (V2-05 touches migrations, RLS, permissions, auth and billing, so all apply).
- Branch `v2/phase-05-<slug>` off `feature/v2`. Never touch `main`.

<user_constraints>
## User Constraints (from CONTEXT.md)

No CONTEXT.md exists for this phase (`init.phase-op 05` → `has_context: false`). The binding constraints are the approved-doc decisions:

### Locked decisions (from the approved docs)
- **C19 / ADR-006 (amended):** `has_permission(tenant, perm)` is a STABLE SQL function with a **hard-coded `CASE` over the 5 fixed roles**. No `role_permissions` table, join or codegen. A unit test asserts parity with `lib/permissions/matrix.ts`, and pgTAP covers the policies. [CITED: docs/v2/V2_MASTER_ROADMAP.md:256]
- **PO-3 ✅:** receptionists register patients. Adopted default (the PO may override): receptionists register, book and collect, with no clinical notes. Doctors view invoices for their own visits and use Sign & Bill, but do not collect, edit paid invoices or refund. Admins have no clinical-note access by default. [CITED: V2_MASTER_ROADMAP.md:66]
- **PO-20 / C44:** GST-exclusive price. `plan_prices` stores `base_amount_paise` 149900, `tax_rate_bp` 1800, `tax_inclusive = false`, and the charge is derived (176882 paise). [CITED: V2_MASTER_ROADMAP.md:82, :601]
- **PO-21 / C41:** no purchasable AI in v2.0. `ai_assist` and `ai_voice_receptionist` are seeded with `purchasable = false`, `visibility = 'coming_soon'` and no provider plan. `standard_trial` grants `ai.scribe` with `ai.scribe.monthly_drafts = 1500`. [CITED: V2_MASTER_ROADMAP.md:83, :530]
- **PO-25 (open, default applies):** preview access ends with the trial, so `standard` has `ai.scribe` = false and limit 0. [CITED: V2_MASTER_ROADMAP.md:87]
- **C48:** the owner opt-in stays mandatory for preview AI. [CITED: V2_MASTER_ROADMAP.md:606]
- **C18:** atomic writes are plpgsql RPCs, `SECURITY INVOKER` under RLS, with audit and outbox written inside them. The D1 spike in V2-03 proves the pattern. [CITED: V2_MASTER_ROADMAP.md:255]
- **C20 / ADR-0005 (+C50):** the service role is used only through `getSystemDb(reason)` in `lib/supabase/system.ts`, from `lib/jobs/**`, `features/*/system.ts` and `app/api/{jobs,webhooks}/**`. Supabase Auth admin calls live in `features/auth/system.ts`. [CITED: V2_MASTER_ROADMAP.md:257, :608]
- **C22:** the scheduler is pg_cron + pg_net only.
- **SUB §6.2 exposure rules:** `billing_internal.*` (with `p_tenant` and `p_now`) is revoked from `public, anon, authenticated`. Clients get only caller-bound `public.my_tenant_access(p_tenant)` and `public.my_entitlements(p_tenant)`. [CITED: docs/v2/SUBSCRIPTIONS_AND_PLANS.md §6.2]
- **SUB §8.1 actor rule:** a `platform.*` RPC called as `postgres`/`service_role` requires `p_actor` to be an active `platform_admins` row. For JWT callers `p_actor` is ignored, and `is_platform_admin()` with aal2 is required.
- **AUTH-D1:** invite = link + set password, no OTP. Email-bound, 72 h, revoke/resend rotates the token, delivered by an outbox email through SES. [CITED: docs/v2/AUTH_REDESIGN.md §3.2]
- **Roadmap allows the 05a/05b split at plan time** without changing the order. [CITED: V2_MASTER_ROADMAP.md:782, :1008]

### Claude's discretion
Helper layering, file layout, the pgTAP generator design, migration granularity, the exact names of new permission keys, and the SUB-01 table subset. Recommendations below.

### Deferred (out of scope)
SUB-03…SUB-11 (Razorpay, lifecycle jobs, GST invoices, owner billing UI, export, archive/purge, admin portal), `tenant_addons` (deferred with SUB-11), AI gateway/Vertex (AI-04/05, V2-12), staff UI (AUTH-06 UI, J-A2/J-A6 Playwright, V2-11), clinical immutability triggers (V2-09a), the atomic command RPCs (P1-05, V2-07), billing invariants (P1-06, V2-10), trigram indexes (P2-08 trigram part, V2-08).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description (roadmap §10) | Research support |
|----|---|---|
| P1-01 | Role-aware RLS (ADR-006) for clinical, financial and comms tables + generated pgTAP matrix covering 100% of tenant tables | Inventory §A; helper layer (Pattern 1); matrix generator (Pattern 4); proposed table→permission map (§B) |
| P1-02 | Composite `(tenant_id, id)` FKs (NOT VALID → diagnose → VALIDATE); `prescription_items.tenant_id` | FK inventory §A.3; composite FK list §C/05-03; SET NULL column-list pitfall (verified) |
| P1-04 (trigger part) | Audit v2: actor forced from `auth.uid()`; revoke direct INSERT | `audit_logs_insert_member` lets any member insert any actor (§A.2); `lib/audit/audit.ts` inserts directly |
| P1-08 | CASCADE → RESTRICT on clinical/financial children; drop `visits_delete_member` | Delete-action inventory §A.3; tenant-cascade still works with RESTRICT (verified) |
| P1-10 | Referrals: receiver updates status only; target constrained; consent check | Receiver-column guard **already exists** (`referrals_target_update_guard`, 000021). Remaining: target directory/opt-in + consent check |
| P1-11 | Exports require `exports:create`; minimal DTOs | Staff session already needs `exports:create` (`features/dpdp/export.ts:45-53`, ruling 01-09). Remaining: API-key path + DTO allow-list |
| P1-39 | `btree_gist` exclusion constraint, no double-booking | Verified working pattern (immutable wrapper); NOT VALID impossible (verified) |
| P1-40 | Per-tenant-per-day queue-token counter, IST date in SQL | Replaces `generate_daily_queue_token` (MAX+1, `features/queue/service.ts:69`) |
| P2-08 (FK part) | FK indexes | 46 FK columns without a leading index (§A.3) |
| P0-14 (backend) | Receptionist registration in matrix + RLS | `receptionist` lacks `patients:edit` (`lib/permissions/matrix.ts:55-61`) |
| AUTH-05 | `memberships.status`, `remove_member`, `revoke_user_sessions`, key/invite revocation | `memberships` has no status column (§A.2). AUTH-00 spike proved the `auth.sessions` delete locally |
| AUTH-06 (backend) | Invitations v2 | `consume_invitation` is not email-bound; expiry 7 days (`features/staff/actions.ts:56`); no delivery |
| SUB-01 | Catalogue, prices, entitlements, `tenant_subscriptions`, `platform_settings`, events, access functions, wrappers, transition RPCs, `platform.*` actor rule, seeds, drop v1 tables, `comp_until` | §D |
| SUB-02 | Hard stop: RLS + storage on the access helper, signed-URL TTL caps, guards, layout redirects, functional locked pages, `/api/v1` 402, jobs skip locked tenants | §D, Pitfalls 6-9 |
| AI-18 | AI catalogue rows not purchasable; trial limit 1500; `platform.set_product_availability` | §D |
| AI-03 (DB) | Opt-in, objection flag, kill switch, quota with expiring reservations | §D.4 |
| AI-06 L2 (DB part) | Gating contract matrix against `has_entitlement`, opt-in, objection, kill switch, quota | §D.4, Validation Architecture |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary tier | Secondary tier | Rationale |
|---|---|---|---|
| Role permission decision | Database (`authz.role_has_permission`, `has_permission`) | API/Backend (`lib/permissions` guard, same matrix) | ADR-006: the DB is authoritative, the app guard gives fast typed errors; a parity test keeps them equal |
| Tenant and role isolation of rows | Database (RLS policies via `authz` helpers) | — | Must hold for direct PostgREST calls with a user JWT |
| Referential tenant integrity | Database (composite FKs) | API (`lib/auth/tenant-refs.ts`, kept as a friendly-error layer) | OA-4: app checks exist; the DB constraint is defence in depth |
| No double-booking / token uniqueness | Database (exclusion constraint, counter table) | API maps `23P01` to a 409 `AppError` | Races cannot be solved in app code |
| Subscription access level | Database (`billing_internal.tenant_access_level`, computed from timestamps) | API guard (`assertTenantAccess`), layout redirect (UX) | SUB §6.2: a missed job can never extend access |
| Entitlements | Database (`billing_internal.has_entitlement` / `entitlement_limit`) | API (`requireEntitlement`) | Same pattern |
| Storage hard stop | Database (`storage.objects` policies on the same helper) | API (signed-URL TTL cap in `lib/storage`) | Storage API calls are RLS-checked; service-role signing bypasses RLS, so the app cap matters |
| Membership removal / session revocation | Database (`remove_member`, `revoke_user_sessions` SECURITY DEFINER) | API (server action, `hardSignOut` later) | AUTH-00 proved the `auth.sessions` delete |
| Invite email delivery | Backend jobs (V2-04 `jobs` + V2-03 email transport) | Database (`invite_staff` RPC enqueues in-tx) | Outbox: exactly one enqueue per invite version |
| Locked pages / redirects | Frontend server (layout, `/billing/locked`) | — | UX only; never the control |

## Standard Stack

### Core (all already present: no installs)
| Component | Version | Purpose | Why standard |
|---|---|---|---|
| Postgres (Supabase local image) | 17.11 [VERIFIED: `show server_version` on local stack] | RLS, composite FKs, exclusion constraints, `ON DELETE SET NULL (col)` (PG ≥ 15) | Platform DB |
| pgTAP | 1.3.3, available, not installed [VERIFIED: `pg_available_extensions`] | DB unit tests (`policies_are`, `results_eq`, `throws_ok`, `is`) | Supabase-documented test runner [CITED: supabase.com/docs/guides/database/testing] |
| `supabase test db` (CLI 2.120.0) | pulls `public.ecr.aws/supabase/pg_prove:3.36` [VERIFIED: probe run] | Runs pgTAP files; installs pgtap for the run and removes it afterwards | Verified: a probe file passed, and `pg_extension` showed no `pgtap` after the run |
| `btree_gist` | 1.7, available [VERIFIED] | `uuid WITH =` inside a GiST exclusion constraint | Standard for no-overlap constraints [CITED: postgresql.org docs] |
| `pg_trgm` | 1.6, installed in `public` | Not touched (trigram search is V2-08) | — |
| Vitest | ^3.0.8 (existing) | Parity unit test, concurrency tests (50 check-ins, booking race, `ai_reserve`), integration tests | Existing DB lane |
| `@supabase/supabase-js` | ^2.49.1 (existing) | Tests call RPCs as real users | Existing |

### Alternatives considered
| Instead of | Could use | Tradeoff / ruling |
|---|---|---|
| pgTAP via `supabase test db` | Vitest-only RLS matrix | Vitest per cell needs a signed-in client per role and is slow (thousands of cells). pgTAP runs the matrix in one transaction with `set local role` + JWT claims. **Use pgTAP for the matrix and time travel; Vitest for parity, concurrency and app-level behaviour.** |
| `pg` npm driver for the parity test | Exposed `public.permission_matrix()` SQL function | Adding `pg` is a new dependency. A SECURITY INVOKER IMMUTABLE function that only expands the static CASE is harmless to expose. **Use the function.** |
| Column privileges to hide `clinical_notes` | Vertical split into an RLS table | Supabase docs: column privileges are per Postgres role, "We do not recommend using column-level privileges for most users", and "using `select *` will fail" [CITED: supabase.com/docs/guides/database/postgres/column-level-security]. **Split.** |
| `role_permissions` table | Hard-coded CASE | Locked by C19. |

**Installation:** none. Enable `btree_gist` in a migration (`create extension if not exists btree_gist with schema extensions;`). Do not install pgTAP in a migration (the CLI handles it).

## Package Legitimacy Audit

This phase installs **no** npm, PyPI or crates packages. `btree_gist` and `pgtap` are contrib/Postgres extensions shipped in the Supabase Postgres image (verified present in `pg_available_extensions`). The `supabase/pg_prove` container image is pulled by the already-pinned Supabase CLI.

| Package | Registry | Verdict | Disposition |
|---|---|---|---|
| (none) | — | — | — |

**Packages removed due to [SLOP] verdict:** none. **Flagged [SUS]:** none.

---

## A. Current-state inventory (evidence)

Commands (local stack only):
```bash
npx supabase status            # stack up; DB = postgresql://postgres:postgres@127.0.0.1:54322/postgres
DB=postgresql://postgres:postgres@127.0.0.1:54322/postgres
psql $DB -c "select version,name from supabase_migrations.schema_migrations order by 1"   # 000001…000024 applied
psql $DB -c "<pg_class/pg_attribute query: tenant_id, relrowsecurity, policy count>"
psql $DB -c "select tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public'"
psql $DB -c "<pg_constraint contype='f' query with confdeltype and leading-index check>"
```
The local DB was empty (0 tenants, patients, visits) at research time. The migrations applied = repo `000001`…`000024` [VERIFIED: `supabase_migrations.schema_migrations`].

### A.1 Tables (43 in `public`; no views; no other app schemas)

- **9 global reference tables** (no `tenant_id`, RLS on, one `SELECT USING (true)` policy for `authenticated`): `cdci_brands`, `cdci_drug_forms`, `cdci_generics`, `cdci_medicines_search`, `cdci_products`, `cdci_routes`, `cdci_substances`, `cdci_suppliers`, `opd_diagnoses`.
- **Root:** `tenants` (no `tenant_id`; keyed by `id`).
- **32 tables with `tenant_id NOT NULL`**, plus **`prescription_items` with no `tenant_id`** (scoped through `prescription_id`): 33 tenant-scoped tables. Every one has RLS enabled. **None has FORCE RLS.** [VERIFIED: pg_class query]
- `clinical_notes` is **not a table**. It is a column on `visits` (with `vitals`, `chief_complaints`, `specialty_data`, `investigations_advised`, `advice`) and on the dead `consultations` table [VERIFIED: information_schema.columns]. `PRODUCT_BASELINE.md:194` confirms "`visits` = appointment **and** encounter". There is **no `appointments` table**: "appointments" are `visits` with `origin_type = 'scheduled'`.

### A.2 Current policies (per table: role `authenticated` unless noted; "member" = `tenant_id IN (SELECT current_user_tenant_ids())`; "OA" = inline `EXISTS memberships … role IN ('owner','admin')`)

| Table | SELECT | INSERT | UPDATE | DELETE | Notes |
|---|---|---|---|---|---|
| tenants | member (`id IN …`) | — | OA | — | |
| memberships | member | — (RPC only) | self or `current_user_is_admin_or_owner` | — | Column grants: `authenticated` may UPDATE only `qualifications, medical_council_reg_no, default_specialty, full_name, phone, availability_schedule, default_slot_duration_minutes` [VERIFIED: attacl]; `memberships_profile_update_guard` trigger |
| invitations | OA | owner/admin; admin/owner roles only by owner (000019) | — | — | grants: INSERT, SELECT only |
| subscriptions (v1) | OA | — | — | — | to be dropped (SUB-01) |
| payment_records (v1) | OA | — | — | — | to be dropped |
| patients | member | member | member | — | |
| visits | member | member | member | OA (`visits_delete_member`) | P1-08 drops DELETE |
| visit_revisions | member | member | — | — | snapshot holds clinical content |
| consultations (dead) | ALL member | | | | D10 expects 0 rows; no `from("consultations")` in app code |
| consultation_diagnoses | member | member | member | OA | doctor's "diagnosis.remove" (`features/terminology/service.ts:272`) is filtered to 0 rows for non-owner/admin |
| prescriptions | member | member | member | OA | |
| prescription_items | via prescriptions subquery | same | same | owner/admin via subquery | **Defect:** doctor's `deletePrescriptionItem` (`features/prescriptions/service.ts:304-316`) deletes 0 rows, reports success and writes an audit row |
| invoices | member | member | member | — | |
| invoice_items | member | member | member | **none** | **Defect:** `features/billing/service.ts:616-617` calls `.delete()`, which RLS always filters to 0 rows |
| payments | member | member | — | — | |
| queue_tokens | member | member | member | OA | |
| waitlist_entries | member | member | member | OA | |
| schedule_blocks | member | member + own/doctor/OA | member + own/doctor/OA | own/doctor/OA | |
| follow_ups | member | member | member | OA | app deletes follow-ups as doctor (`features/consultation/service.ts:186-188`) |
| consent_records | member | member | — | — | |
| patient_documents | ALL member | | | | |
| document_share_tokens | member | (RPC only; grants SELECT only) | | | |
| referrals | originating: ALL member; target: SELECT + UPDATE where `target_tenant_id` is a member tenant | | | | `referrals_target_update_guard` (000021) limits the receiver to `status`/`acknowledged_at`/`updated_at`, sent→acknowledged |
| doctor_custom_diagnoses / _medicines / doctor_prescription_templates | member | member | member | member | not restricted to own `doctor_id` |
| communication_queue | member | member AND `created_by = auth.uid()` | — | — | SEC matrix wants no direct INSERT |
| in_app_notifications | ALL member | | | | **any member reads any colleague's notifications** (SEC matrix: ❌) |
| tenant_messaging_config | ALL member | | | | SEC matrix: UPDATE owner/admin only |
| audit_logs | OA | **member, any `actor_id`** | — | — | P1-04: forgeable actor |
| api_keys, api_key_usage_daily, webhook_subscriptions, webhook_delivery_queue | ALL OA | | | | |
| cdci_* (8), opd_diagnoses | `true` | — | — | — | grants still include INSERT/UPDATE/DELETE/TRUNCATE |

Source: `pg_policies` dump [VERIFIED: local stack]. Policy origins: `000001_foundation.sql:46-72`, `000003:64-100`, `000011:26-39`, `000013:168-242`, `000019`, `000021`.

**Grants (defence in depth gap):** `anon` and `authenticated` hold `arwdDxtm` (including **TRUNCATE**, REFERENCES, TRIGGER) on almost every public table, and `pg_default_acl` grants the same on **every new table and function** created by `postgres` in `public` [VERIFIED: `pg_default_acl`, `has_table_privilege('anon','public.visits','TRUNCATE') = t`]. RLS does not apply to TRUNCATE. PostgREST cannot issue it, but any future SECURITY INVOKER dynamic SQL could. **New gating tables and functions must explicitly REVOKE**, or they inherit full DML and EXECUTE.

**Helper functions in `public` today** (all SECURITY DEFINER, `search_path=''`, EXECUTE granted to `authenticated`) [VERIFIED: pg_proc + pg_get_functiondef]:
- `current_user_tenant_ids()`: `SELECT m.tenant_id FROM public.memberships m WHERE m.user_id = auth.uid();` (no status, no access level)
- `current_user_has_role(p_tenant_id uuid, p_roles text[])`, `current_user_is_admin_or_owner(p_tenant_id uuid)`
- `create_clinic_with_owner(p_name text)`: inserts the tenant and an owner membership. **Creates no subscription row.**
- `consume_invitation(p_token_hash text)`: locks the row, checks `consumed_at`/`expires_at`, inserts the membership. **No `invited_address` binding** (SEC-08 / AUTH-06).
- `generate_daily_queue_token(p_tenant_id uuid, p_date date)`: `COALESCE(MAX(token_number),0)+1`. Races under concurrency (DB-09).
- `change_member_role(p_membership_id uuid, p_role text)`: P0-02 last-owner guard, writes `audit_logs`.
- Anon-callable SECURITY DEFINER RPCs that read tenant data and bypass RLS: `consume_reschedule_token`, `get_reschedule_context`, `resolve_share_token`. **SUB-02 must add an access-level check inside these** (RLS helpers do not run there).
- `communication_queue_claim` / `communication_queue_finish` are EXECUTE-granted to `authenticated` (V2-04's concern; note for review).

### A.3 Foreign keys: composite candidates, delete actions, missing indexes

No parent has `UNIQUE (tenant_id, id)` [VERIFIED: pg_constraint contype u/x]. `memberships` has `UNIQUE (user_id, tenant_id)` (`unique_user_tenant`), which a composite FK to a member can reference.

| Child.column → parent | ON DELETE now | Leading index | Target (P1-02 / P1-08) |
|---|---|---|---|
| visits.patient_id → patients | CASCADE | no (has `(tenant_id, patient_id)`) | composite, RESTRICT |
| invoices.patient_id → patients / invoices.visit_id → visits | CASCADE / CASCADE | no / no | composite, RESTRICT |
| invoice_items.invoice_id → invoices | CASCADE | no | composite, CASCADE kept (an item belongs to its invoice; paid-invoice protection is V2-10) |
| payments.invoice_id → invoices | CASCADE | no | composite, RESTRICT |
| prescriptions.patient_id / visit_id | CASCADE / CASCADE | no / no | composite, RESTRICT |
| prescription_items.prescription_id → prescriptions | CASCADE | yes | add `tenant_id`; composite; CASCADE kept (draft item removal) |
| consultation_diagnoses.patient_id / visit_id | CASCADE / CASCADE | no / no | composite, RESTRICT |
| consultations.patient_id | CASCADE | no | composite, RESTRICT (or drop the dead table, Open Q5) |
| consent_records.patient_id | CASCADE | no | composite, RESTRICT (consent is evidence) |
| follow_ups.patient_id / visit_id | CASCADE / SET NULL | no / no | composite; RESTRICT / `SET NULL (visit_id)` |
| patient_documents.patient_id / visit_id | CASCADE / SET NULL | no / yes | composite; RESTRICT / `SET NULL (visit_id)` |
| document_share_tokens.document_id → patient_documents | CASCADE | no | composite, CASCADE kept |
| communication_queue.patient_id / appointment_id(→visits) | CASCADE / SET NULL | no / no | composite; RESTRICT / `SET NULL (appointment_id)` |
| queue_tokens.visit_id | CASCADE | yes (unique) | composite, RESTRICT |
| visit_revisions.visit_id | CASCADE | yes | composite, RESTRICT |
| waitlist_entries.patient_id / promoted_visit_id | CASCADE / NO ACTION | no / no | composite; RESTRICT / RESTRICT |
| referrals.patient_id / visit_id | CASCADE / SET NULL | yes / yes | composite; RESTRICT / `SET NULL (visit_id)` |
| referrals.target_tenant_id → tenants | SET NULL | yes | **keep single-column** (cross-tenant by design) |
| api_key_usage_daily.api_key_id → api_keys | CASCADE | yes | composite, CASCADE |
| audit_logs.api_key_id → api_keys | SET NULL | yes | composite `SET NULL (api_key_id)` |
| webhook_delivery_queue.subscription_id → webhook_subscriptions | CASCADE | yes | composite, CASCADE |
| doctor refs → `auth.users` (visits, prescriptions, consultations, follow_ups, waitlist_entries, schedule_blocks, doctor_custom_* ×2, doctor_prescription_templates `.doctor_id`; referrals.referring_doctor_id) | NO ACTION (schedule_blocks CASCADE) | no | composite `(doctor_id, tenant_id) → memberships(user_id, tenant_id)` (D5 / OA-4 "doctor" refs) |
| actor columns (`created_by`, `recorded_by`, `uploaded_by`, `amended_by`, `signed_by`, `closed_by`, `consumed_by`) → auth.users | NO ACTION / SET NULL | no | keep; DB-stamp from `auth.uid()` belongs to V2-07/09a |
| every `tenant_id` → tenants | CASCADE | yes | keep CASCADE (tenant purge and test teardown depend on it) |

46 FK columns lack a leading btree index (all marked "no" above, plus every `auth.users` actor column) [VERIFIED: FK/pg_index query]. Composite FKs should get `(tenant_id, <fk>)` indexes, which serve both the RLS filter and the FK check. Supabase: "A column counts as indexed only when it comes first in a btree index" [CITED: supabase.com/docs/guides/database/postgres/row-level-security].

Polymorphic columns with no FK (by design): `audit_logs.entity_id`, `document_share_tokens.resource_id` [VERIFIED].

### A.4 Permission model (`lib/permissions/**`)

`lib/permissions/matrix.ts:3-23` (verbatim keys): `"*"`, `"clinic:manage"`, `"clinic:view"`, `"staff:invite"`, `"staff:view"`, `"billing:view"`, `"patients:view"`, `"patients:edit"`, `"appointments:view"`, `"appointments:edit"`, `"prescriptions:view"`, `"prescriptions:edit"`, `"consultations:view"`, `"consultations:edit"`, `"vitals:view"`, `"vitals:edit"`, `"labs:view"`, `"labs:edit"`, `"reports:view"`, `"exports:create"`. [VERIFIED: Read lib/permissions/matrix.ts:3-23]

`ROLE_PERMISSIONS` (`:25-75`) [VERIFIED: Read]:
- `owner: ["*"]`
- `admin`: clinic:manage, clinic:view, staff:invite, staff:view, billing:view, patients:view, patients:edit, appointments:view, appointments:edit, reports:view
- `doctor`: clinic:view, staff:view, patients:view, patients:edit, appointments:view, appointments:edit, prescriptions:view, prescriptions:edit, consultations:view, consultations:edit, vitals:view, vitals:edit, labs:view, labs:edit
- `receptionist`: clinic:view, staff:view, patients:view, appointments:view, appointments:edit
- `nurse`: clinic:view, staff:view, patients:view, patients:edit, appointments:view, appointments:edit, consultations:view, vitals:view, vitals:edit, labs:view, labs:edit

`hasPerm` (`lib/permissions/index.ts`): `"*"` grants everything, otherwise exact match. `UserRole = "owner" | "admin" | "doctor" | "receptionist" | "nurse"` (`lib/db/types.ts:1`). `requirePermission` (`lib/permissions/guards.ts:16-28`) resolves membership through `getActiveMembership()` (`lib/auth/tenant.ts`), which selects `memberships(tenant_id, role)` with **no status filter**.

Gaps against PO-3: receptionists lack `patients:edit` (registration, F-01) and any billing key. Billing actions are guarded by `appointments:edit` (`features/billing/actions.ts:39,47,61,67`), so **doctors and nurses can collect today**, which PO-3 forbids for doctors. `billing:view` is used in 4 places (reports, subscription page, share receipt). Permission keys used by code: patients:view 16, clinic:manage 15, appointments:edit 15, consultations:edit 14, patients:edit 11, consultations:view 11, appointments:view 9, billing:view 4, clinic:view 2, vitals:edit 1, staff:invite 1 [VERIFIED: grep].

### A.5 Invites, memberships, subscriptions, storage, AI

- `memberships` columns: `id, user_id, tenant_id, role, created_at, qualifications, medical_council_reg_no, signature_url, default_specialty, full_name, phone, availability_schedule, default_slot_duration_minutes`. **No `status`.** [VERIFIED: information_schema]
- `invitations` columns: `id, tenant_id, role, invited_address, token_hash (UNIQUE), expires_at, consumed_at, consumed_by, created_by, created_at` [VERIFIED: Read 000002_invitations_billing.sql:12-23]. No `revoked_at`, `token_version` or `last_sent_at`. `inviteStaff` inserts directly under RLS with a **7-day** expiry (`features/staff/actions.ts:56`) and sends nothing (`:79` "delivery arrives with AUTH-06"). `acceptInvite` calls `consume_invitation` (`:117-135`). `/join` page exists: `app/(auth)/join/page.tsx`. **No `removeStaff` action exists** (`features/staff/*`).
- v1 subscription tables [VERIFIED: Read 000002:29-51]: `subscriptions(id, tenant_id UNIQUE, plan DEFAULT 'standard', amount_inr DEFAULT 1000, status CHECK IN ('active','past_due','canceled','trialing'), current_period_end, …)` and `payment_records(id, tenant_id, amount_inr, paid_at, method DEFAULT 'upi', reference, created_at)`. Readers: `features/billing/subscription.ts`, `app/(dashboard)/settings/billing/page.tsx`, `lib/db/types.ts:92`. Tests: `tests/integration/subscription.spec.ts`, `tests/security/cross-tenant.spec.ts:61-80`, `tests/security/p0-01-action-sweep.spec.ts:73`, `tests/helpers/rls.ts:3-12` (`TENANT_OWNED_TABLES` lists both), `tests/security/guard/engine.ts`.
- **No** `plans`, `plan_prices`, `entitlement_keys`, `tenant_subscriptions`, `platform_settings`, `platform_admins`, `tenant_ai_settings`, `ai_usage_monthly` or `ai_quota_reservations` tables, and no `patients.ai_processing_objected` column [VERIFIED: table list + patients columns].
- **Storage buckets** [VERIFIED: storage.buckets]: `prescriptions` (private, 10 MB, `application/pdf`; created in `000008:8`) and `clinic-records` (private, 25 MB, pdf/jpeg/png/webp; `000013:11`). `storage.objects` policies (all `authenticated`, tenant-only via `current_user_tenant_ids()` on the path prefix with a raw `::uuid` cast): prescriptions SELECT/INSERT/UPDATE (no DELETE); clinic-records SELECT/INSERT/UPDATE/DELETE, accepting `tenants/<uuid>/…` or `<uuid>/…`. Signed-URL TTLs: default 3600 s (`lib/storage/supabase-provider.ts:65`), labs 3600 (`features/labs/service.ts:260`), referrals 3600 (`features/referrals/service.ts:519`, `pdf/generator.ts:90`), share 600 (`features/sharing/system.ts:41`). SUB-02 caps in-app views at 300 s.

### A.6 Tests and test infrastructure

- **pgTAP: not set up.** `supabase/tests/` holds two psql scripts (`memberships_bounds_cleanup.sql`, `search_medicines_extension_schema.sql`) that print `PASS:` and are **not run by CI** (no reference in `.github/workflows/ci.yml` or `tests/`). Running `npx supabase test db --local` on the default directory **fails**: "Parse errors: No plan found in TAP output … Result: FAIL" [VERIFIED: run 2026-11-13]. A pgTAP file in another directory passed (`Files=1, Tests=3 … Result: PASS`) [VERIFIED: probe].
- CI `test` job: starts the stack, then `npx vitest run … --coverage.enabled`, the report gate (0 failed, 0 skipped/todo), and the P0-13 canary (`ci.yml:100-146`). **No pgTAP step.**
- `scripts/phase-evidence.mjs` runs Vitest, typecheck, eslint and inventory only (`:69-127`). **No pgTAP.**
- `tests/helpers/rls.ts` `assertRlsCatalog()` calls `get_tenant_table_rls_policies()` (000005) over an 8-table list.
- `tests/setup/teardown.ts` deletes tenants (cascade), then auth users, after a leak check over `NO_ACTION_USER_REFS` ("23 columns"), which `tests/setup/teardown.spec.ts` checks **against the live catalogue**. Any new `auth.users` FK with NO ACTION breaks that spec until the list is updated, and the list assumes "Every one of these tables has `tenant_id`" (`teardown.ts:29-31`), which `platform_admins` would violate.
- E2E `knownBug` markers that V2-05 can flip: **F-01** (receptionist cannot register, "fixed by PO-3 in V2-05/V2-08") and **P1-07** (the receptionist's consultation page renders notes). `knownBug` turns the run red when the bug is fixed, so the plan must remove the markers it fixes (`tests/e2e/support/known-bug.ts:1-9`).

---

## B. Proposed role matrix for the policies (CTO default; PO-3 + SECURITY_VERIFICATION_PLAN §6.1)

New permission keys (added to `matrix.ts` **and** the SQL CASE in the same migration/PR):
- `receptionist` gains `patients:edit` (P0-14; `patients` holds demographics plus `allergies`/`chronic_conditions` captured at registration) and `billing:collect`.
- New `billing:collect` = owner (`*`), admin, receptionist. Guards `recordPayment`, `addInvoiceItem`, `deleteInvoiceItem`, `createVisitInvoice` (replacing `appointments:edit`). The doctor's Sign & Bill stays on `consultations:edit` (invoice creation for own visit only); doctors never get payments INSERT.
- `billing:view` extended to receptionist (collection screens).

| Table group | SELECT | INSERT / UPDATE | DELETE |
|---|---|---|---|
| tenants | any active member (any access level) | `clinic:manage` | none |
| memberships | own row (any access level, any status) + `staff:view` | profile columns: self or `clinic:manage` (existing column grants) | none (status via `remove_member`) |
| invitations | `staff:invite` | via `invite_staff` RPC only (revoke direct INSERT) | none |
| patients, consent_records | `patients:view` | `patients:edit` | none (erasure RPC) |
| visits (non-clinical columns after split), queue_tokens, waitlist_entries, schedule_blocks (existing own/doctor rules kept), follow_ups | `appointments:view` | `appointments:edit` (follow_ups also `consultations:edit`) | follow_ups: `consultations:edit`; schedule_blocks: existing rule; others none |
| **clinical_notes (new)**, consultation_diagnoses, visit_revisions, consultations | `consultations:view` | `consultations:edit` (visit_revisions via amend RPC) | consultation_diagnoses: `consultations:edit` (draft) |
| prescriptions, prescription_items | `prescriptions:view` | `prescriptions:edit` | prescription_items: `prescriptions:edit` (draft) |
| patient_documents + `clinic-records` bucket | `labs:view` | `labs:edit` | `labs:edit` |
| `prescriptions` bucket | `prescriptions:view` | `prescriptions:edit` | none |
| invoices, invoice_items, payments | `billing:view` OR (doctor AND own visit) | `billing:collect` (invoices also doctor via Sign & Bill on own visit) | invoice_items: `billing:collect` (unpaid; status guard is V2-10) |
| referrals (originating) | `consultations:view` | `consultations:edit` | none |
| doctor_custom_*, doctor_prescription_templates | `consultations:view` | `consultations:edit` AND `doctor_id = auth.uid()` | same |
| in_app_notifications | `recipient_user_id = auth.uid()` | system only | none |
| tenant_messaging_config | `clinic:view` | `clinic:manage` | none |
| communication_queue | `appointments:view` | none direct (outbox / RPC) | none |
| audit_logs | `clinic:manage` | none direct (`log_audit` RPC + trigger) | none |
| api_keys, api_key_usage_daily, webhook_* | `clinic:manage` | `clinic:manage` | `clinic:manage` |
| tenant_subscriptions, subscription_events (SUB) | `current_user_billing_tenant_ids()` (owner/admin, any access level) | none (RPCs) | none |
| plans, plan_prices, plan_entitlements, entitlement_keys | `authenticated` where `visibility <> 'hidden'` | none | none |
| platform_* | none | none | none |

Every clinical/operational policy uses the **full-access** helper; tenants, memberships and the billing tables use the member or billing helpers (see Pattern 1). This matrix is the single source for the pgTAP generator. **[ASSUMED: CTO default derived from the approved docs; PO confirmation recommended for the receptionist/billing keys, see Open Q2]**

---

## C. Plan-by-plan breakdown

Migration numbering continues `000025…` unless V2-03 plan 03-03 changes the convention (follow 03-03). Each bullet is one migration file unless noted.

### 05-01 `authz` helpers, `has_permission()`, parity test, pgTAP harness (M)
- Migration: schema `authz` (not in `[api] schemas`, which is `["public","storage","graphql_public"]`, `supabase/config.toml:6`). `GRANT USAGE ON SCHEMA authz TO authenticated` (policies evaluate as the caller). Functions:
  - `authz.role_has_permission(p_role text, p_perm text) returns boolean` IMMUTABLE: the hard-coded CASE (C19).
  - `authz.has_permission(p_tenant uuid, p_perm text) returns boolean` STABLE SECURITY DEFINER `search_path=''`: caller's membership role in `p_tenant` (plus status and access level later).
  - `authz.member_tenant_ids()`: active membership, any access level (tenants, memberships). `authz.full_tenant_ids()`: active membership AND access level `full` (body returns the same as member until 05-10). `authz.tenant_ids_with(p_perm text)`: full tenants where the role grants `p_perm` (the policy workhorse; Pattern 1).
  - `public.permission_matrix() returns table(role text, perm text)` SECURITY INVOKER IMMUTABLE: expands the CASE for the parity test (exposed on purpose; static data).
  - Repoint `public.current_user_tenant_ids()` to `authz.full_tenant_ids()` (keeps every existing policy working through the transition), keeping its signature.
- Tests: Vitest `tests/permissions/has-permission-parity.spec.ts` (every role × every key from `matrix.ts`, `"*"` expanded, equals `permission_matrix()`; plus the reverse: SQL has no key that TS lacks). pgTAP `supabase/tests/database/authz_helpers.test.sql`.
- Harness: move the two legacy psql scripts to `supabase/scripts/` (or convert them to pgTAP); create `supabase/tests/database/`; add a CI step `npx supabase test db --local supabase/tests/database` after the stack starts (wrap the image pull in `scripts/ci/retry.mjs` as for `supabase start`); add the TAP output to `scripts/phase-evidence.mjs`; add the command to CLAUDE.md "Commands".
- Generator: `scripts/gen-authz-pgtap.ts` reads `tests/authz/table-matrix.ts` (§B) and writes `supabase/tests/database/authz_matrix.test.sql` (fixtures inlined). A Vitest check asserts the committed file equals the generator output. A pgTAP **completeness test** asserts `set_eq(<catalog: public tables with tenant_id + prescription_items + tenants>, <matrix tables>)`, which makes "100% of tenant tables" mechanical.

### 05-03 Composite FKs (M), before 05-02 because `prescription_items.tenant_id` feeds its policy
1. Expand: `ALTER TABLE … ADD CONSTRAINT …_tenant_id_id_key UNIQUE (tenant_id, id)` on patients, visits, invoices, prescriptions, patient_documents, api_keys, webhook_subscriptions (plain DDL; no data, so CONCURRENTLY is unnecessary and impossible inside a migration transaction).
2. Expand: `prescription_items.tenant_id uuid` nullable + backfill from `prescriptions` + a BEFORE INSERT trigger that fills it from the parent (so current app inserts keep working) + `SET NOT NULL` + index.
3. Expand: composite FKs `NOT VALID`, created **with the final delete action** (RESTRICT, or `SET NULL (col)` for nullable visit/appointment/api_key refs) + `(tenant_id, fk)` indexes; doctor refs → `memberships(user_id, tenant_id)`.
4. Diagnose: run BACKEND_MIGRATION_PLAN §3 D1 + D5 (local, Pitfall 12), store the counts in the phase evidence; then `VALIDATE CONSTRAINT` (separate migration).
5. Contract: drop the old single-column FKs (separate migration).
- Tests: pgTAP "cross-tenant child insert fails" for every composite FK (`throws_ok(…, '23503')`); `fk_ok` / `col_is_fk`; `tests/security/cross-tenant-refs.spec.ts` stays green (app check returns a friendly error first).

### 05-04 RESTRICT + delete-policy removal (S)
- Delete actions are already set in 05-03 step 3. This plan drops `visits_delete_member` and any parent-row DELETE policy (prescriptions, queue_tokens, waitlist_entries) and fixes the child DELETE policies the app needs (draft diagnosis, draft Rx item, invoice item, follow-up), per §B.
- Tests: deleting a patient with a visit fails `23503`; deleting a visit with an invoice fails; **deleting a tenant still cascades everything** (teardown depends on it; verified compatible with RESTRICT, Pitfall 4).

### 05-02 Per-domain policies (L)
One migration per domain; each `DROP POLICY` + `CREATE POLICY` pair inside one migration transaction, so there is no open window:
1. **Clinical split (expand):** `public.clinical_notes(tenant_id, visit_id PK, chief_complaints, clinical_notes, specialty_data, investigations_advised, advice, created_at, updated_at)` with composite FK to visits; backfill; a temporary trigger mirroring writes from `visits` columns. **Migrate:** switch reads and writes in `features/{visits,consultation,prescriptions,patients,dpdp}`, `app/api/v1/visits/**`, `components/{consultation,visits,patients}` (about 18 files reference `clinical_notes`). **Contract:** drop the columns from `visits` (separate migration, end of 05-02). Open Q1.
2. Clinical policies: clinical_notes, consultation_diagnoses, consultations, visit_revisions, prescriptions, prescription_items, doctor_custom_*, referrals (originating).
3. Front desk: patients (P0-14), consent_records, visits, queue_tokens, waitlist_entries, schedule_blocks, follow_ups, communication_queue (revoke INSERT).
4. Financial: invoices, invoice_items, payments; app guard change `appointments:edit` → `billing:collect`.
5. Admin/system: tenants, memberships, invitations, api_*, webhook_*, tenant_messaging_config, in_app_notifications.
6. **Audit (P1-04 trigger part):** `public.log_audit(p_action text, p_entity_type text, p_entity_id uuid, p_metadata jsonb)` SECURITY DEFINER (actor = `auth.uid()`, role from membership, tenant from the active membership, never from input); a BEFORE INSERT trigger on `audit_logs` that overwrites `actor_id`/`actor_role` whenever a JWT `sub` is present; `REVOKE INSERT ON audit_logs FROM authenticated, anon`; `lib/audit/audit.ts` switches to `.rpc('log_audit')`. Reuse the D1 spike's error mapping. The in-tx part stays in V2-07.
7. Storage policies per bucket on `authz.tenant_ids_with('prescriptions:view'|'labs:view'|…)` with `storage.foldername(name)` and a **safe** UUID test instead of a raw `::uuid` cast (C9 "storage policy cast fix").
8. Grants: `REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated`; revoke INSERT/UPDATE/DELETE on cdci_*/opd_diagnoses from tenant roles; `ALTER DEFAULT PRIVILEGES … REVOKE` the same, so future tables start closed.
- Tests: the generated matrix (pgTAP); "receptionist read of `clinical_notes` returns 0 rows / permission denied" (pgTAP + one Vitest PostgREST check with a receptionist JWT); "receptionist inserts a patient" (pgTAP + Vitest through `createPatient`); remove the e2e knownBug markers that flip (F-01; P1-07 if the page stops rendering notes); `tests/auth/rbac.spec.ts:42` changes (`receptionist patients:edit` → true).

### 05-06 Referrals + exports (S)
- Referrals: the receiver-column guard exists (`referrals_target_update_guard`, `000021_review_fixes.sql`). Add: `target_tenant_id` allowed only for tenants in an opt-in directory (new `tenant_directory(tenant_id PK, listed boolean, …)` or `tenants.referral_directory_opt_in boolean`; Open Q6), checked by a CHECK-via-trigger at INSERT; in-network INSERT requires `patient_consents_history_sharing = true` when `consented_history_snapshot` is non-null; snapshot server-built (stays app-side).
- Exports: staff path already requires `exports:create` (`features/dpdp/export.ts:45-53`). Add a DTO allow-list for the export payload and route the API-key path through `exports:create` when `/api/v1` is re-enabled (P1-37; PO-16 says off). Verify `app/api/v1/patients/[id]/export/route.ts:64-92`.
- Tests: pgTAP target-tenant insert refused for a non-listed tenant; consent check; Vitest DTO shape test.

### 05-08 Exclusion constraint + queue-token counter + FK indexes (M)
- `create extension if not exists btree_gist with schema extensions;` + an IMMUTABLE wrapper `public.visit_slot(p_at timestamptz, p_mins int) returns tstzrange` + run diagnostic D6 + `EXCLUDE USING gist (tenant_id WITH =, doctor_id WITH =, public.visit_slot(scheduled_at, estimated_duration_minutes) WITH &&) WHERE (origin_type = 'scheduled' AND NOT is_overbooked AND status NOT IN ('cancelled','no_show'))`. **Cannot be NOT VALID** (Pitfall 2). Map SQLSTATE `23P01` → 409 `AppError` in `features/visits/scheduling-service.ts`.
- `public.queue_token_counters(tenant_id, date, last_token int, PK (tenant_id, date))` + `public.next_queue_token()` (tenant from the caller's full membership; date = `(now() AT TIME ZONE t.timezone)::date`, `tenants.timezone` defaults to `'Asia/Kolkata'` [VERIFIED: Read 000002:9]); `INSERT … ON CONFLICT (tenant_id, date) DO UPDATE SET last_token = queue_token_counters.last_token + 1 RETURNING last_token`; seed from `max(token_number)` per tenant/day; switch `features/queue/service.ts:69`; revoke and drop `generate_daily_queue_token` in a later contract migration. The full check-in RPC stays V2-07 (P1-05).
- Remaining FK indexes from §A.3 (auth.users actor columns that are filtered or joined).
- Tests: Vitest booking race (two parallel `bookAppointment` for the same slot → one success, one 409); Vitest 50 parallel check-ins → 50 distinct tokens 1…50 with `date = IST date`; pgTAP `has_index` for every FK.

### 05-09 SUB-01 schema, access functions, seeds, SQL runbook + AI-18 (M-L)
Order: (1) schemas `billing_internal` and `platform` (revoke `ALL` on schema and default function EXECUTE from `public`); (2) tables `plans`, `plan_prices` (`charge_amount_paise bigint GENERATED ALWAYS AS (base_amount_paise + round(base_amount_paise * tax_rate_bp / 10000.0)::bigint) STORED`; verified = 176882), `entitlement_keys`, `plan_entitlements`, `tenant_entitlement_overrides`, `tenant_subscriptions` (PK `tenant_id`; columns per SUB §7.1 including `comp_until`, `access_ends_at`, `version`), `subscription_events` (append-only by **grants**, Pitfall 5), `platform_settings` (single row, includes `ai_features jsonb`), `platform_admins`, `platform_audit_log`; (3) every table: RLS on, explicit REVOKE of DML from `anon, authenticated`; (4) functions `billing_internal.tenant_access_level(p_tenant, p_now)`, `has_entitlement(p_tenant, p_key, p_now)`, `entitlement_limit(p_tenant, p_key, p_now)`; `public.my_tenant_access(p_tenant)`, `public.my_entitlements(p_tenant)`; `public.is_platform_admin()`; transition RPCs needed now: `billing_internal.start_trial(p_tenant, p_now)` (incomplete → trialing; used by seeds and later SUB-03), `platform.extend_trial`, `platform.set_comp`, `platform.grant_override`, `platform.create_plan_price`, `platform.set_product_availability` (all with the §8.1 actor rule, writing `platform_audit_log` + `subscription_events`); (5) `create_clinic_with_owner` also inserts `tenant_subscriptions(status = 'incomplete')`, plus an AFTER INSERT trigger on `tenants` guaranteeing exactly one row (Open Q4); (6) seeds (Pattern 6); (7) drop v1 `subscriptions`/`payment_records` and rewrite `features/billing/subscription.ts` + `settings/billing/page.tsx` to read `tenant_subscriptions` (minimal); update the tests listed in §E; (8) `docs/runbooks/subscriptions-sql.md`.
- **Test helper change lands here, before 05-10:** `seedTenantSubscription()` and a default subscription row in `seedTenantWithOwner` (§E).
- Table subset: the roadmap SUB-01 row lists catalogue, prices, entitlement keys, `tenant_subscriptions`, `platform_settings` and events [CITED: V2_MASTER_ROADMAP.md:494]. `saas_payments`, `saas_invoices`, `saas_invoice_sequences`, `billing_profiles`, `provider_webhook_events` are first used by SUB-03/05 in V2-13b. **Recommend creating them in V2-13b** (Open Q3).

### 05-05 AUTH-05 membership status, removal, revocation (M)
- Expand: `memberships.status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','removed'))`, `removed_at`, `removed_by`; column not in the self-update grant list. Helper bodies: `authz.member_tenant_ids()` and `full_tenant_ids()` filter `status = 'active'` (one change; every policy inherits it). `getActiveMembership()` filters `status = 'active'`.
- `public.remove_member(p_membership_id uuid, p_reason text)` SECURITY DEFINER: caller has `staff:invite`/`clinic:manage` in the target's tenant; owner/admin targets need an owner caller; last-owner guard (reuse `change_member_role` logic); sets status; `api_keys.revoked_at = now()` where `created_by = target` in the tenant; revokes pending invites `created_by = target`; audit with counts.
- `public.revoke_user_sessions(p_user_id uuid)` SECURITY DEFINER, EXECUTE **service_role only**; `DELETE FROM auth.sessions WHERE user_id = p_user_id` (AUTH-00: works locally, cascades refresh tokens; hosted re-check is V2-03 03-12 [CITED: .planning/phases/01A-local-db-harness/01A-04-AUTH00-SPIKE.md:31,207]). Called from `features/auth/system.ts` after `remove_member` commits. **Never ban the auth user** (multi-clinic).
- `public.session_is_live()` SECURITY DEFINER (AUTH §3.5; the spike shows a SECURITY INVOKER read of `auth.sessions` is denied).
- Server action `removeStaff` in `features/staff` (backend only; UI and Playwright J-A6 in V2-11).
- `lib/api/auth.ts` already filters `revoked_at IS NULL` (`:95-97`), so a removed member's keys 401 automatically.
- Tests: pgTAP "removed member reads 0 rows with a still-valid JWT" across every table in the matrix (the generator adds a `removed` principal); `remove_member` revokes keys and invites; `revoke_user_sessions` not executable by `authenticated`/`anon`; Vitest: a removed user's existing client gets 0 rows, then `refreshSession()` fails.

### 05-07 AUTH-06 invitations v2 backend (M) **(blocked on V2-04 04-01/04-03 and V2-03 03-11)**
- Expand `invitations`: `revoked_at`, `revoked_by`, `token_version int default 1`, `last_sent_at`, `send_count`; unique partial index "one pending invite per (tenant_id, lower(invited_address))".
- `public.invite_staff(p_email text, p_role text)` returns the raw token **once** to the server only (or the server generates the token and passes the hash): checks `staff:invite`; owner-only for owner/admin roles; dedupes the pending invite; `expires_at = now() + interval '72 hours'`; enqueues `jobs(kind='email.invite', dedupe_key = 'invite:'||id||':v'||token_version)` **in the same transaction** (V2-04 API). `revoke_invitation`, `resend_invitation` (rotates hash, bumps `token_version`, new dedupe key). Revoke direct INSERT on `invitations`.
- `public.peek_invitation(p_hash)` (anon; returns clinic name, role, masked email, status only).
- `public.consume_invitation(p_hash)`: requires `lower(auth.email()) = invited_address`, not revoked, not expired, single use. `public.consume_invitation_for(p_user_id, p_hash)` service_role only (unconfirmed-invitee path after `admin.createUser`/`updateUserById` in `features/auth/system.ts`).
- The email handler (`email.invite`) renders a link only (no PHI) and sends through the V2-03 transport; Mailpit locally.
- Tests: pgTAP invite cases (mismatched email, expired, revoked, reused, unconfirmed invitee, admin-by-admin refused); Vitest "one invite → exactly one email under retry": call `inviteStaff` twice (second dedupes), run N parallel dispatchers, assert Mailpit count = 1; resend → exactly one more email and the old link fails.

### 05-10 SUB-02 enforcement + AI-03 DB + AI-06 L2 DB (L)
- Helper bodies: `authz.full_tenant_ids()` adds `billing_internal.tenant_access_level(m.tenant_id, now()) = 'full'`; add `authz.billing_tenant_ids()` (owner/admin; `full`, `locked`, `onboarding`); billing/subscription/profile policies use it; tenants/memberships stay on `member_tenant_ids()` (Pitfall 7).
- Storage policies already call `tenant_ids_with(...)`, so the lock applies to storage automatically. Verify that list/download/upload are denied.
- Anon/definer RPCs: `resolve_share_token`, `get_reschedule_context`, `consume_reschedule_token`, `create_share_token`, `search_medicines`, `generate_tenant_invoice_number` refuse a non-`full` tenant (Rx verification while `expired` shows metadata only per SUB-D6).
- App: `assertTenantAccess('full')` inside `requirePermission` (typed `TenantLockedError` / `SUBSCRIPTION_LOCKED`); `requireEntitlement(key)`; `app/(dashboard)/layout.tsx` redirects (`locked` → `/billing/locked` for owner/admin, `/billing/locked/staff` for others; `onboarding` → `/onboarding/billing` placeholder); functional, unstyled locked pages (axe clean at 360/tablet/desktop); signed-URL cap 300 s in `lib/storage` (900 s reserved for exports); `/api/v1` returns 402 for locked tenants (`lib/api/auth.ts`); the V2-04 job runner skips non-`full` tenants (one check in the claim loop or handler wrapper).
- AI-03 DB: `tenant_ai_settings(tenant_id PK, enabled, accepted_terms_version, accepted_by, accepted_at)` (UPDATE only by owner under RLS); `patients.ai_processing_objected boolean NOT NULL DEFAULT false`, `objected_at`, `objection_recorded_by` (follows `patients:edit`); `platform_settings.ai_features` kill switch; `ai_usage_monthly(tenant_id, period text, feature, units, PK(tenant_id, period, feature))`, `ai_quota_reservations(id, tenant_id, feature, period, expires_at)`; `public.ai_reserve(p_feature text, p_timeout_s int)`, `ai_commit(p_reservation uuid)`, `ai_release(p_reservation uuid)` (SECURITY DEFINER, tenant from the caller's full membership, `SELECT … FOR UPDATE` on the usage row, counts only `expires_at > now()` reservations; period = trial start while `trialing`, else IST calendar month `to_char(now() AT TIME ZONE 'Asia/Kolkata','YYYY-MM')`); no DML grants on gating tables for tenant roles.
- AI-06 L2 DB part: one caller-bound decision function `public.ai_preflight(p_feature text, p_patient_id uuid) returns text` (`'ok' | 'not_entitled' | 'not_opted_in' | 'patient_objected' | 'killed' | 'over_quota' | 'locked'`) that V2-12's gateway calls; the L2 matrix is a pgTAP table over subscription states × controls [ASSUMED design; AI §4.6 lists the controls, not the function].
- Tests: §Validation Architecture rows 8-13.

---

## D. SUB-01 / AI-18 / AI-03 numbers the acceptance requires

| Item | Value | Source |
|---|---|---|
| Standard base | `base_amount_paise = 149900`, `tax_rate_bp = 1800`, `tax_inclusive = false`, `billing_model = 'flat_recurring'`, `currency 'INR'`, `interval 'month'`, `interval_count 1` | SUB §7.1, §8.1 [CITED] |
| Derived charge | 149900 + round(149900 × 1800 / 10000) = **176882** paise | [VERIFIED: generated column computed 176882 on the local PG, rolled back] |
| Trial | `plans.trial_days = 14`; `standard.trial_plan_id → standard_trial` (non-public); grace `first_charge_grace_days 4`, `renewal_grace_days 7`; `platform_settings.pending_charge_buffer_hours 24`, `lock_window_days 30`, `purge_after_days 180` | SUB §4, §6.2, §7.1 [CITED] |
| `standard_trial` entitlements | `ai.scribe` enabled; `ai.scribe.monthly_drafts` limit **1500** (counted over the whole trial; period key = trial start) | PO-21; AI §4.6 [CITED] |
| `standard` | `ai.scribe` false, `ai.scribe.monthly_drafts` 0 (PO-25 default); all `assist.*` true; `core.*` true; `messaging.monthly_quota` limit set by SQL | SUB §7.3, AI §6.2 [CITED] |
| AI products | `ai_assist`, `ai_voice_receptionist`: `kind 'addon'`, `category 'ai'`, `purchasable false`, `visibility 'coming_soon'`, no active price / no `provider_plan_id` | AI-18 [CITED] |
| Keys to seed (`entitlement_keys`) | `assist.terminology`, `assist.frequent_rx`, `assist.shorthand`, `assist.snapshot`, `assist.slots`, `assist.duplicates`, `assist.followup`, `assist.allergy_check`, `assist.dup_therapy`, `assist.help`, `assist.vitals`, `ai.scribe`, `ai.scribe.monthly_drafts` (limit), `ai.operations_copilot`, `ai.clinical_copilot`, `ai.patient_advice`, `ai.scribe.voice`, `ai.voice_receptionist`, `ai.voice_receptionist.monthly_minutes` (limit), `core.*`, `messaging.monthly_quota` (limit) | AI §6.2 table [CITED: docs/v2/AI_STRATEGY.md:349-362] |
| States | `incomplete → onboarding`; `trialing`/`active`/`past_due` with `p_now < access_ends_at → full`; `expired`/`archived`/stale → `locked`; `purged → none`; `comp_until > p_now → full` for any status except `purged` | SUB §6.1-6.2 [CITED] |
| `has_entitlement` order | (1) access `full`; (2) non-expired override wins; (3) `trialing` → trial plan's entitlements; (4) base plan; `entitlement_limit` returns the largest applicable limit | SUB §7.2 [CITED] |
| `set_product_availability` | refuses `purchasable = true` while the product has no active `plan_prices` row with a `provider_plan_id` | SUB §7.1 [CITED] |

## E. Impact on existing tests and seeds (`create_clinic_with_owner` → `incomplete`)

Every tenant-creation site [VERIFIED: grep for `create_clinic_with_owner`, `from("tenants").insert`, `INTO public.tenants`]:

| Site | How it creates a tenant | Required change |
|---|---|---|
| `tests/helpers/tenants.ts:44-110` `seedTenantWithOwner` | service-role `tenants.insert` + owner membership | add `seedTenantSubscription(tenantId, { status: 'trialing' \| 'active', comp?: boolean })` (SUB §11 "Test seeds") and call it by default (`trialing`, `plan_price_id` = Standard, `trial_end = now()+14d`, `access_ends_at = trial_end + 24h`). Used by **47 test files** including `tests/e2e/global-setup.ts` and `tests/security/guard/world.ts` |
| `tests/helpers/tenants.ts:320-325` (ecosystem builder) | via `seedTenantWithOwner` | inherits |
| `scripts/seed-local-dev.ts:104-108` | service-role `tenants.insert` | upsert a subscription with `comp_until = now() + 1 year` **and** `plan_price_id` = Standard, status `active` (Pitfall 8) |
| `tests/e2e/support/m0-data.ts` | uses tenants created in global-setup | inherits; long e2e runs need `access_ends_at` beyond the run (trialing 14 d is fine) |
| `features/clinics/actions.ts:51` → `create_clinic_with_owner` | onboarding UI (`app/(onboarding)/clinic/new/page.tsx`) | tenant becomes `incomplete` → `/onboarding/billing` (placeholder until V2-13b; no acceptance before V2-13b may require signup, roadmap §11) |
| `tests/integration/multi-tenancy.spec.ts:73-100` | calls the RPC, then reads `tenants` + `memberships` | stays green only if tenants/memberships use the **member** helper (Pitfall 7) |
| `tests/security/membership-guard.spec.ts:404` | anon call to the RPC (must still fail) | none |
| `supabase/tests/memberships_bounds_cleanup.sql:23` | raw insert, rolled back | none (not RLS-dependent) |
| `tests/integration/subscription.spec.ts`, `tests/security/cross-tenant.spec.ts:61-80`, `tests/security/p0-01-action-sweep.spec.ts:73`, `tests/helpers/rls.ts:3-12`, `tests/security/guard/engine.ts` | read v1 `subscriptions`/`payment_records` | rewrite against `tenant_subscriptions` (owner/admin read; doctor 0 rows; cross-tenant 0 rows) |
| `tests/setup/teardown.ts` `NO_ACTION_USER_REFS` + `teardown.spec.ts` | catalogue check of NO ACTION `auth.users` FKs | add every new NO ACTION user column (`removed_by`, `revoked_by`, `accepted_by`, `granted_by`, `objection_recorded_by`, `platform_admins.user_id`…); handle non-tenant tables (`platform_admins`) separately |
| `tests/auth/rbac.spec.ts:42` | asserts receptionist lacks `patients:edit` | flip (P0-14) |
| `tests/e2e/journeys/journey-08-role-restrictions.spec.ts`, m0 `register-patient` | knownBug F-01 / P1-07 | remove the markers the DB fix resolves |

Acceptance 11 ("after 05-10 every existing DB suite stays green") is met by landing the helper change in **05-09** and running the full suite once before flipping the helper body in 05-10.

---

## Architecture Patterns

### System architecture (request → decision)

```
 browser (user JWT) ──► Next server action / route ──► requirePermission(perm)
        │                       │                         ├─ getActiveMembership (status='active')
        │                       │                         ├─ assertPerm (lib/permissions/matrix.ts)   ◄── parity test ──┐
        │                       │                         └─ assertTenantAccess('full') → TenantLockedError → /billing/locked
        │                       ▼                                                                                       │
        │               supabase-js (user JWT) ── .from()/.rpc() ──► PostgREST ──► Postgres                             │
        │                                                                │                                              │
        └── direct PostgREST / Storage API (attacker path) ─────────────►│                                              │
                                                                         ▼                                              │
              RLS policy: tenant_id IN (SELECT authz.tenant_ids_with('perm'))   ◄─ initPlan, evaluated once per statement│
                              │                                                                                         │
                              ▼                                                                                         │
              authz.tenant_ids_with(perm)  [SECURITY DEFINER, search_path='']                                            │
                 memberships m WHERE m.user_id = auth.uid() AND m.status='active'                                       │
                   AND authz.role_has_permission(m.role, perm)   ◄── hard-coded CASE (C19) ─────────────────────────────┘
                   AND billing_internal.tenant_access_level(m.tenant_id, now()) = 'full'
                              │                                        │
                              │                                        └─► tenant_subscriptions (timestamps; comp_until)
                              ▼
              composite FKs (tenant_id, x) → parent(tenant_id, id)   — cross-tenant references impossible
              exclusion constraint / counter table                   — races impossible
```

### Pattern 1: Policy helpers with stable signatures (evolve the body, never the policies)
**What:** every policy calls a set-returning helper inside `IN (SELECT …)`. Supabase: wrapping lets the optimizer run an initPlan once per statement instead of once per row [CITED: supabase.com/docs/guides/database/postgres/row-level-security]. The helper layers are member (any access), full (clinical/operational), and billing (owner/admin, any access).
```sql
-- Source: pattern per Supabase RLS performance guide; names are this research's recommendation [ASSUMED names]
create or replace function authz.role_has_permission(p_role text, p_perm text)
returns boolean language sql immutable parallel safe set search_path = '' as $$
  select case p_role
    when 'owner' then true                                   -- matrix.ts: owner: ["*"]
    when 'admin' then p_perm = any (array['clinic:manage','clinic:view','staff:invite','staff:view','billing:view',
                                          'patients:view','patients:edit','appointments:view','appointments:edit','reports:view'])
    when 'doctor' then p_perm = any (array[ /* matrix.ts:39-54 verbatim */ ])
    when 'receptionist' then p_perm = any (array[ /* matrix.ts:55-61 + PO-3 additions */ ])
    when 'nurse' then p_perm = any (array[ /* matrix.ts:62-74 verbatim */ ])
    else false end $$;

create or replace function authz.tenant_ids_with(p_perm text)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.tenant_id from public.memberships m
  where m.user_id = (select auth.uid())
    -- 05-05: and m.status = 'active'
    -- 05-10: and billing_internal.tenant_access_level(m.tenant_id, now()) = 'full'
    and authz.role_has_permission(m.role, p_perm) $$;

create policy visits_select on public.visits for select to authenticated
  using (tenant_id in (select authz.tenant_ids_with('appointments:view')));
```
Keep `authz` out of `[api] schemas`. Supabase: "A `security definer` function in an exposed schema is callable over the Data API with the creator's privileges" [CITED: same page].

### Pattern 2: Composite FK, expand → validate → contract
```sql
-- 1 (expand)
alter table public.patients add constraint patients_tenant_id_id_key unique (tenant_id, id);
alter table public.visits add constraint visits_tenant_patient_fkey
  foreign key (tenant_id, patient_id) references public.patients (tenant_id, id) on delete restrict not valid;
create index if not exists idx_visits_tenant_patient on public.visits (tenant_id, patient_id);  -- exists today
-- nullable child ref: SET NULL must name the column, or tenant_id is nulled too (verified)
alter table public.follow_ups add constraint follow_ups_tenant_visit_fkey
  foreign key (tenant_id, visit_id) references public.visits (tenant_id, id) on delete set null (visit_id) not valid;
-- 2 (after diagnostics D1/D5 = 0): alter table public.visits validate constraint visits_tenant_patient_fkey;
-- 3 (contract): alter table public.visits drop constraint visits_patient_id_fkey;
```
VALIDATE takes `SHARE UPDATE EXCLUSIVE` (plus `ROW SHARE` on the referenced table); ADD FOREIGN KEY takes `SHARE ROW EXCLUSIVE` on both tables [CITED: postgresql.org/docs/17/sql-altertable.html].

### Pattern 3: No double-booking (verified on PG 17.11)
```sql
create extension if not exists btree_gist with schema extensions;
create function public.visit_slot(p_at timestamptz, p_mins int) returns tstzrange
  language sql immutable parallel safe set search_path = '' as
  $$ select tstzrange(p_at, p_at + make_interval(mins => p_mins), '[)') $$;
-- minute-only interval addition does not depend on TimeZone, so declaring IMMUTABLE is sound
alter table public.visits add constraint visits_no_double_booking
  exclude using gist (tenant_id with =, doctor_id with =, public.visit_slot(scheduled_at, estimated_duration_minutes) with &&)
  where (origin_type = 'scheduled' and not is_overbooked and status not in ('cancelled','no_show'));
-- second overlapping insert → ERROR 23P01 conflicting key value violates exclusion constraint (verified);
-- the same slot with is_overbooked = true → accepted (verified); back-to-back 10:00-10:15 / 10:15 → accepted ('[)')
```

### Pattern 4: pgTAP matrix cell (user simulation verified)
```sql
begin;
select plan(3);
-- fixtures inserted as postgres (inlined by the generator)
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'receptionist_uid', 'role', 'authenticated')::text, true);
select is_empty($$ select 1 from public.clinical_notes $$, 'receptionist: clinical_notes SELECT denied');
select lives_ok($$ insert into public.patients (tenant_id, full_name, phone, created_by)
                   values (:'tenant', 'Synthetic', '+919000000001', :'receptionist_uid') $$, 'receptionist registers a patient');
select throws_ok($$ insert into public.visits (tenant_id, patient_id, …) values (:'tenant', :'other_tenant_patient', …) $$,
                 '23503', null, 'cross-tenant child insert fails');
select * from finish();
rollback;
```
`auth.uid()` reads `request.jwt.claim.sub` or `request.jwt.claims->>'sub'` [VERIFIED: pg_get_functiondef('auth.uid')]. Inserting a `storage.objects` row as `postgres` and reading it back as a simulated `authenticated` member works for storage-policy tests [VERIFIED: probe, rolled back]. (`:'var'` psql variables are illustrative; the generator should inline literal UUIDs.)

### Pattern 5: Queue token counter
```sql
insert into public.queue_token_counters (tenant_id, date, last_token)
values (v_tenant, (now() at time zone v_tz)::date, 1)
on conflict (tenant_id, date) do update set last_token = public.queue_token_counters.last_token + 1
returning last_token, date;
```
The row lock taken by `ON CONFLICT DO UPDATE` serialises concurrent callers per tenant-day; no MAX scan.

### Pattern 6: Seeds and test helper
```ts
// tests/helpers/tenants.ts (05-09). Service role is allowed in tests/seeds.
export async function seedTenantSubscription(tenantId: string, opts: { status?: "trialing" | "active"; comp?: boolean } = {}) {
  // upsert tenant_subscriptions: plan_price_id = Standard price id (looked up by plan code), status,
  // trial/period dates relative to now(), access_ends_at, comp_until (comp ? now()+1y : null)
}
```

### Anti-patterns to avoid
- **Rewriting 30 policies in 05-05 and again in 05-10.** Put status and access in helper bodies (Pattern 1).
- **Per-row `has_permission(tenant_id, perm)` in USING.** It is called per row; use the set form inside `IN (SELECT …)`.
- **RLS helpers in `public`** that take arbitrary `p_tenant`/`p_now` (SUB §6.2: `billing_internal` only).
- **`::uuid` cast on storage path segments** inside policies (errors on malformed names). Use a regex guard or `storage.foldername` + `is_safe_storage_key`.
- **Time travel through a session GUC in production RLS.** RLS uses `now()`; test the lock by moving `access_ends_at` (Pitfall 10).

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---|---|---|---|
| Double-booking check | App "check then insert" (`features/visits/scheduling.ts`) | `EXCLUDE USING gist` | Races; DB-08 |
| Daily token | `MAX()+1` | Counter table `ON CONFLICT DO UPDATE … RETURNING` | DB-09 race |
| Cross-tenant reference check | More app lookups | Composite FKs (app check kept for messages) | OA-4 |
| Role permission storage | `role_permissions` table / codegen | CASE (C19) + parity test | Locked |
| Quota counting | App counters | `ai_reserve` with `FOR UPDATE` + expiring reservations | AI §4.6 |
| Session revocation | `admin.signOut(userId)` | Delete `auth.sessions` rows in a definer RPC | `signOut` takes a JWT, not a user id (AUTH §3.6) |
| Exactly-once enqueue | App "already sent?" flags | V2-04 `jobs.dedupe_key UNIQUE` inserted in the RPC's transaction | Outbox |
| GST arithmetic in TS | Float math | Integer paise generated column | 176882 exact |
| pgTAP runner | Custom psql harness | `supabase test db` | Verified working |

## Runtime State Inventory (refactor/migration aspects)

| Category | Items found | Action |
|---|---|---|
| Stored data | Local DB empty (0 tenants). Hosted **test** project (PO-1: no real patients) has v1 data; production is new (PO-1/PO-15). v1 `subscriptions`/`payment_records` hold only seeded rows. | No data migration to production. Backfills (`prescription_items.tenant_id`, `clinical_notes`, counter seeds) run inside migrations and are idempotent. |
| Live service config | None. The hosted test project is never migrated by Claude (CLAUDE.md). Staging (V2-03 03-08) receives migrations through CI/PO process. | Planner: confirm whether V2-05 migrations are applied to staging, and by whom (PO). |
| OS-registered state | None (no cron yet; pg_cron jobs arrive with V2-04). | V2-05 adds no cron. |
| Secrets/env vars | None renamed. New env only if the invite email needs a link base URL (`APP_BASE_URL`, likely from V2-03's env schema). | Add to the V2-03 env schema, not `.env`. |
| Build artifacts | Generated types (V2-03 03-03: `types/database.ts`) go stale with each migration; `lib/db/types.ts` (hand-written v1 types) references `subscriptions`. | Regenerate types in each plan (`npx supabase gen types typescript --local`); the drift check must stay green. |

## Common Pitfalls

1. **`clinical_notes` is a column, not a table.** Row RLS on `visits` cannot hide it from receptionists who need the row. Column privileges are per Postgres role and break `select *` (Supabase docs; `features/visits/scheduling-service.ts` uses `select("*")` 5 times). Fix: vertical split (05-02 step 1). **Warning sign:** a plan that writes "receptionist policy on visits" and claims acceptance 2.
2. **Exclusion constraint:** the DB-08/D6 expression `tstzrange(scheduled_at, scheduled_at + make_interval(…))` fails with `functions in index expression must be marked IMMUTABLE` (`timestamptz_pl_interval` is STABLE) [VERIFIED]. `EXCLUDE constraints cannot be marked NOT VALID` [VERIFIED; CITED: PG docs "NOT VALID … only allowed for foreign key and CHECK constraints"]. Run D6 first; use the immutable wrapper.
3. **Composite FK with plain `ON DELETE SET NULL`** nulls `tenant_id` too → `null value in column "tid" … violates not-null constraint` [VERIFIED]. Use `SET NULL (visit_id)` (PG ≥ 15; local is 17.11).
4. **RESTRICT vs tenant cascade.** Deleting a tenant still cascades through children that RESTRICT each other (verified in both FK creation orders, minimal probe). Keep a pgTAP test "delete tenant cascades", because `tests/setup/teardown.ts` and the future purge depend on it.
5. **Append-only via trigger breaks cascades.** A `BEFORE DELETE … RAISE` trigger on `subscription_events`/`platform_audit_log` also fires on the tenant cascade and breaks teardown. Enforce append-only with **grants** (no UPDATE/DELETE for tenant roles; RI actions run as owner).
6. **Default privileges.** New `public` tables and functions get full DML and EXECUTE for `anon`/`authenticated`, and Postgres grants function EXECUTE to PUBLIC by default [VERIFIED: pg_default_acl]. Every gating table needs explicit REVOKEs. `billing_internal`/`platform` need `REVOKE ALL ON SCHEMA … FROM public` and `ALTER DEFAULT PRIVILEGES IN SCHEMA … REVOKE EXECUTE ON FUNCTIONS FROM public`. Acceptance 9 should test `has_function_privilege('authenticated', f, 'EXECUTE')` for **every** function in the schema (catalogue loop), not a hand list.
7. **Locked tenants must still resolve their membership.** If `memberships`/`tenants` used the full-access helper, `getActiveMembership()` would see no clinic and route a locked owner to "no clinic" instead of `/billing/locked`. Use the member helper for those two tables, the billing helper for billing tables, and full for everything else.
8. **Comp on a tenant with no price.** `has_entitlement` step (4) reads the base plan through `plan_price_id`; a comped `incomplete` tenant with a null `plan_price_id` has `full` access but **no** `assist.*` keys. Seeds must set `plan_price_id`.
9. **Definer RPCs bypass the hard stop.** `resolve_share_token`, `get_reschedule_context`, `consume_reschedule_token` (anon) and service-role signed URLs (`features/sharing/system.ts`) do not pass through RLS helpers. Add explicit `tenant_access_level` checks (05-10).
10. **`now()` is frozen per transaction in pgTAP.** Time travel goes through `p_now` on `billing_internal.*` (called as postgres/service_role). The RLS-level "locked tenant gets 0 rows" test moves `access_ends_at` to before the transaction start instead.
11. **Silent RLS no-ops.** A DELETE/UPDATE filtered by RLS returns no error. Existing defects: doctor's draft Rx item delete and diagnosis remove (owner/admin-only DELETE policies), and `invoice_items` delete (no DELETE policy) [VERIFIED: pg_policies + `features/prescriptions/service.ts:304-316`, `features/billing/service.ts:616-617`]. Services should check affected-row counts (`.select()` after delete) in 05-02/05-04.
12. **"The diagnostics run" vs CLAUDE.md.** The roadmap says diagnostics run on the hosted test project (V2_MASTER_ROADMAP.md:683), which Claude may not touch. Run D1–D8 on the **local** stack after a full Vitest + e2e run with seeded data (and synthetic edge cases planted in a rolled-back pgTAP "migration test" file); the PO may run the read-only queries on the hosted test DB optionally. P0-16a is "Accepted as not required by the PO" (VERIFICATION_LOG.md:657).
13. **Legacy psql scripts break `supabase test db`** on the default path [VERIFIED]. Move or convert them before adding the CI step.
14. **knownBug flips turn e2e red** (F-01, P1-07). Remove markers in the plan that fixes them.
15. **Doctor FK to memberships + teardown order.** `(doctor_id, tenant_id) → memberships(user_id, tenant_id)` blocks deleting a membership with history. Teardown deletes tenants before users, so it is fine, but any code that deletes memberships (none today; AUTH-05 uses status) would fail.
16. **Invite "exactly one email".** With at-least-once workers, a crash between SES accept and `done` can resend. The acceptance is met by dedupe at enqueue + atomic claim (V2-04), tested under action retry and parallel dispatchers. Document the residual crash window.

## Code Examples

The caller-bound wrapper (SUB §6.2):
```sql
create function public.my_tenant_access(p_tenant uuid) returns text
language sql stable security definer set search_path = '' as $$
  select billing_internal.tenant_access_level(p_tenant, now())
  where exists (select 1 from public.memberships m
                where m.tenant_id = p_tenant and m.user_id = (select auth.uid()) and m.status = 'active') $$;
revoke execute on function public.my_tenant_access(uuid) from public, anon;
grant execute on function public.my_tenant_access(uuid) to authenticated;
```
The access function itself (verbatim design): SUBSCRIPTIONS_AND_PLANS.md §6.2 (`billing_internal.tenant_access_level(p_tenant uuid, p_now timestamptz)` with the `purged`/`comp_until`/`incomplete`/`full`/`locked` CASE and the revoke/grant lines).

## State of the Art

| Old approach (in repo) | Current approach | Impact |
|---|---|---|
| Tenant-only RLS `tenant_id IN (current_user_tenant_ids())` | Role-aware RLS through definer helpers wrapped in `(select …)` | Matches Supabase guidance |
| Single-column FKs | Composite tenant FKs (`UNIQUE (tenant_id, id)`) | Standard shared-schema SaaS integrity |
| `ON DELETE SET NULL` on composite keys | `SET NULL (col)` column list (PG 15+) | Required for composite FKs |
| psql "PASS:" scripts | pgTAP through `supabase test db` | CI-reportable TAP |

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|---|---|---|
| A1 | Vertical split of clinical columns into `public.clinical_notes` (name, column set; vitals stay on `visits`) | C/05-02, Open Q1 | Schema change the PO has not seen; vitals visible to receptionists |
| A2 | New keys `billing:collect`; receptionist gets `patients:edit`, `billing:view`; doctor collect removed | §B | Front-desk or doctor flows break; PO-3 override |
| A3 | SUB-01 creates only the tables V2-05 uses; `saas_*`, `billing_profiles`, `provider_webhook_events` wait for V2-13b | 05-09, Open Q3 | Reviewer reads SUB-01 as "all of §7.1" |
| A4 | AFTER INSERT trigger on `tenants` creating `incomplete` | 05-09, Open Q4 | Double rows if helper also inserts (use upsert) |
| A5 | `public.ai_preflight()` single decision function | 05-10 | V2-12 gateway shape differs |
| A6 | Referral directory as a tenant opt-in flag | 05-06 | PO wants a different directory model |
| A7 | pg_prove in the Supabase image supports psql `\ir`; avoided by inlining fixtures | 05-01 | None if inlined |
| A8 | Test seeds default `trialing` with Standard price; local dev seed comped `active` | §E | Entitlement-dependent tests see wrong keys |
| A9 | Hosted Supabase allows the same `auth.sessions` delete as local (re-check is V2-03 03-12) | 05-05 | Fallback: RLS status + 900 s JWT (AUTH §3.6) |
| A10 | The V2-04 job API exposes an in-transaction enqueue with `dedupe_key` callable from a definer RPC | 05-07 | 05-07 waits or adds its own outbox row |

## Open Questions (with recommended CTO rulings)

1. **How is "receptionist read of `clinical_notes` denied" achieved?** Ruling: vertical split into `public.clinical_notes` (1:1 with `visits`, composite FK, `consultations:view`/`consultations:edit` RLS), expand → migrate → contract inside 05-02, dropping the `visits` columns at the end. Rationale: Supabase recommends RLS and separate tables over column privileges; no production data (PO-15). PO acknowledgement needed (schema change). Alternative rejected: per-role Postgres roles through a custom access-token hook (claims go stale on clinic switch, TARGET_ARCHITECTURE §3.3).
2. **Permission keys for PO-3.** Ruling as §B. Industry practice is least privilege per job function (front desk: demographics, scheduling, cash). Confirm with the PO in one line.
3. **SUB-01 table subset.** Ruling: create the catalogue, subscription, events, overrides, settings and platform tables now; create `saas_*`/`billing_profiles`/`provider_webhook_events` in V2-13b with their first writer (YAGNI; expand-only later, no data).
4. **Subscription-row invariant.** Ruling: `create_clinic_with_owner` inserts `incomplete` (roadmap note) **and** an AFTER INSERT trigger on `tenants` upserts `incomplete`, so a service-role tenant insert can never produce a row-less (silently locked) tenant. Seeds then upgrade to `trialing`/comp.
5. **Dead `consultations` table.** Ruling: gate it with `consultations:view` in 05-02; dropping it is a contract step for V2-09b (with the consult rebuild) unless the PO wants it gone now.
6. **Referral target directory model.** Ruling: `tenants.referral_directory_listed boolean default false`, set by `clinic:manage`; INSERT of an in-network referral requires the target to be listed. Simple and reversible.
7. **J-A6 (Playwright) in V2-05?** The AUTH doc §9 lists it for V2-05, but no staff-removal UI exists and the roadmap V2-05 acceptance does not include it. Ruling: V2-05 proves it at the service/DB layer; Playwright J-A6 moves to V2-11 with the UI. The roadmap is the source of truth.
8. **Staging application of V2-05 migrations.** PO action (operational): confirm who applies them to staging (CI deploy job or PO), since Claude never touches hosted projects.

No external service is required for 05a. 05b needs only what V2-03/V2-04 already deliver (local Mailpit for tests; SES on staging is V2-03's).

## Dependencies on V2-03 / V2-04 (what V2-05 needs, exactly)

| From | Output | Used by |
|---|---|---|
| V2-03 03-03 | B1 baseline + drift report + migration-immutability check + generated `types/database.ts` + regeneration command | every V2-05 migration; typed `.rpc()` for new RPCs |
| V2-03 03-07 | D1 spike report: SECURITY INVOKER RPC under RLS, `auth.uid()` actor, audit + outbox in one tx, SQLSTATE → `AppError` mapping | `log_audit`/audit trigger (P1-04), `remove_member`, `invite_staff`, 23P01/23503 mapping |
| V2-03 03-02 | `lib/supabase/system.ts` `getSystemDb(reason)` | `features/auth/system.ts` (`admin.createUser`, `revoke_user_sessions`), job handlers |
| V2-03 03-01 | Fail-closed env schema | invite link base URL, `AI_ENABLED` |
| V2-03 03-04 | ESLint boundaries | new `features/*/system.ts` files stay inside the allow-list |
| V2-03 03-05 | `lib/datetime` (IST) | TS-side display of token date / trial dates |
| V2-03 03-11/03-12 | AUTH-03 email transport (SES staging, Mailpit local), AUTH-04b password policy + Turnstile + FT-05, hosted `auth.sessions` re-check | 05-07 `/join` set-password, invite email; 05-05 fallback decision |
| V2-04 04-01 | `jobs` table (`dedupe_key UNIQUE NULLS NOT DISTINCT`), claim/lease/reaper, enqueue API usable inside an RPC transaction | 05-07 invite email; 05-10 "jobs skip locked tenants" |
| V2-04 04-02/04-03 | `/api/jobs/run`, dispatcher, inline dispatch removed | 05-07 "exactly one email under retry" test |

05a (05-01, 05-03, 05-04, 05-02, 05-06, 05-08) depends only on 03-03 and 03-07. 05b's 05-07 is the only plan blocked by V2-04.

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|---|---|---|---|---|
| Docker | local stack, pg_prove | ✓ | 29.7.2 | — |
| Supabase CLI | stack, `test db`, `gen types` | ✓ | 2.120.0 (3.1.0 available; stay pinned) | — |
| Postgres (local) | everything | ✓ | 17.11 | — |
| pgtap ext | pgTAP | ✓ (installed per run by CLI) | 1.3.3 | — |
| btree_gist ext | P1-39 | ✓ available | 1.7 | — |
| pg_cron / pg_net | not used by V2-05 | ✓ available | 1.6.4 / 0.20.4 | — |
| psql (host) | diagnostics, ad-hoc probes | ✓ | 14.21 client | `npx supabase db` / docker exec |
| pg_prove image | CI pgTAP | ✓ pulled (`public.ecr.aws/supabase/pg_prove:3.36`) | 3.36 | retry wrapper in CI |
| Mailpit / Inbucket | 05-07 email assertions | local default (not configured in `config.toml`; V2-03 03-11) | — | wait for 03-11 |

**Missing with no fallback:** none for 05a. 05-07 needs V2-04 + V2-03 03-11 outputs.

## Validation Architecture

### Test framework
| Property | Value |
|---|---|
| Framework | pgTAP 1.3.3 via `supabase test db` (new); Vitest ^3 (existing DB lane); Playwright (existing, for knownBug flips + locked-page axe) |
| Config | `supabase/tests/database/*.test.sql` (new dir); `vitest.config.ts` (existing) |
| Quick run | `npx supabase test db --local supabase/tests/database` (< 30 s); `npx vitest run tests/permissions tests/authz` |
| Full suite | `npm run test:db` + `npx supabase test db --local supabase/tests/database` + `npm run e2e:pr` |

### Requirements → test map
| # | Acceptance | Type | Command / file | Exists? |
|---|---|---|---|---|
| 1 | pgTAP matrix covers 100% of tenant tables | pgTAP (generated + completeness `set_eq`) | `supabase/tests/database/authz_matrix.test.sql`, `authz_completeness.test.sql` | ❌ Wave 0 |
| 2 | Receptionist PostgREST read of `clinical_notes` denied | pgTAP + Vitest (real receptionist JWT through supabase-js) | `authz_matrix.test.sql`; `tests/security/role-rls.spec.ts` | ❌ |
| 3 | Cross-tenant child insert fails | pgTAP `throws_ok(…,'23503')` per composite FK | `composite_fks.test.sql` | ❌ |
| 4 | Removed member reads 0 rows with a still-valid JWT | pgTAP (`removed` principal) + Vitest (existing client, then refresh fails) | `authz_matrix.test.sql`; `tests/integration/auth/remove-member.spec.ts` | ❌ |
| 5 | Receptionist can register a patient | pgTAP + Vitest through `createPatient` | `tests/patients/receptionist-registration.spec.ts` | ❌ |
| 6 | Two overlapping non-overbooked appointments cannot both be inserted | pgTAP `throws_ok(…,'23P01')` + Vitest parallel booking | `scheduling_exclusion.test.sql`; `tests/scheduling/no-double-booking.spec.ts` | ❌ |
| 7 | 50 parallel check-ins → 50 distinct tokens, IST date | Vitest concurrency (50 `Promise.all`) | `tests/integration/queue-token-concurrency.spec.ts` | ❌ |
| 8 | `p_now` past `access_ends_at` → 0 rows from every clinical table and storage bucket | pgTAP time travel (function) + matrix `locked` access level (tables + `storage.objects`) | `billing_access.test.sql`, `authz_matrix.test.sql` | ❌ |
| 9 | `authenticated` cannot execute any `billing_internal.*` | pgTAP catalogue loop over `pg_proc` in the schema | `billing_grants.test.sql` | ❌ |
| 10 | One invite → exactly one email under retry | Vitest + Mailpit API | `tests/integration/auth/invite-delivery.spec.ts` | ❌ |
| 11 | Every existing DB suite green after 05-10 | full Vitest + e2e | `npm run test:db`, `npm run e2e:pr` | ✅ (existing suites) |
| 12 | 149900 @ 1800 bp → 176882 | pgTAP `is()` | `billing_catalogue.test.sql` | ❌ |
| 13 | Only Standard purchasable; `set_product_availability` refuses without a provider price; trialing has `ai.scribe` 1500, active Standard none | pgTAP | `billing_catalogue.test.sql`, `ai_gating_l2.test.sql` | ❌ |
| — | `has_permission` parity | Vitest | `tests/permissions/has-permission-parity.spec.ts` | ❌ |
| — | `ai_reserve` concurrency (two reserves at quota−1 → exactly one) + reservation expiry | Vitest + pgTAP | `tests/ai/ai-reserve-concurrency.spec.ts` | ❌ |
| — | Invite pgTAP cases | pgTAP | `invitations_v2.test.sql` | ❌ |
| — | Migration test on a copy seeded with diagnostics' edge cases | pgTAP (plant violations, show VALIDATE/exclusion fail, apply fix, pass), rolled back | `migration_edge_cases.test.sql` | ❌ |

### Sampling rate
- Per task commit: the quick pgTAP run + the touched Vitest files.
- Per plan: full Vitest + full pgTAP.
- Phase gate: `node scripts/phase-evidence.mjs 05-db-authorisation-entitlements/evidence 2` (extended to run pgTAP twice) + CI run id.

### Wave 0 gaps
- [ ] `supabase/tests/database/` + move the legacy psql scripts out of `supabase/tests/`
- [ ] CI step `npx supabase test db --local supabase/tests/database` (with retry) in `.github/workflows/ci.yml` test job
- [ ] `scripts/phase-evidence.mjs`: pgTAP output captured
- [ ] `scripts/gen-authz-pgtap.ts` + `tests/authz/table-matrix.ts` + drift check
- [ ] `tests/helpers/tenants.ts` `seedTenantSubscription` (05-09, before 05-10)
- [ ] CLAUDE.md "Commands": add the pgTAP command

## Security Domain

### Applicable ASVS categories (v4.0.3)
| Category | Applies | Control |
|---|---|---|
| V1 Architecture | yes | DB as the last line of defence; single matrix + parity |
| V2 Authentication | partly | invite acceptance binds email; `/join` set-password policy (AUTH-04b) |
| V3 Session management | yes | `revoke_user_sessions`, `session_is_live`, RLS status cut-off |
| V4 Access control | **yes (core)** | role-aware RLS, composite FKs, `billing_internal` revokes, `platform.*` actor rule, storage policies |
| V5 Validation | yes | CHECKs (status vocabularies), zod at action boundaries |
| V7 Errors/logging | yes | `log_audit` actor forced; no PHI in audit metadata (`ALLOWED_METADATA_KEYS`) |
| V8 Data protection | yes | clinical-notes isolation, locked-tenant storage denial, signed-URL TTL caps |
| V11 Business logic | yes | exclusion constraint, counters, quota reservations, last-owner guard |

### Threat patterns
| Pattern | STRIDE | Mitigation |
|---|---|---|
| Insider receptionist reads clinical notes via PostgREST | Information disclosure | `clinical_notes` table RLS `consultations:view` |
| Cross-tenant reference (tenant A row → tenant B patient) | Tampering | composite FKs |
| Removed staff with a live JWT | Elevation | `status` in helpers; session delete |
| Forged audit actor | Repudiation | trigger overwrites actor; INSERT revoked |
| Locked clinic keeps using data or files | Elevation (billing bypass) | helper access level; storage policies; definer-RPC checks; TTL caps |
| Calling `billing_internal` with a forged `p_now` | Tampering | schema/function revokes; caller-bound wrappers only |
| Platform RPC called with someone else's `p_actor` | Spoofing | §8.1 actor rule; JWT callers' `p_actor` ignored |
| Invite link forwarded to a different email | Spoofing | `consume_invitation` requires `auth.email() = invited_address` |
| Quota race / abuse | DoS (cost) | `FOR UPDATE` reservation, expiry, kill switch |
| SECURITY DEFINER in an exposed schema | Elevation | `authz`/`billing_internal`/`platform` not exposed; `search_path=''`; explicit REVOKE from PUBLIC |

## Recommended split, order, sizes, risks

**Split: yes, 05a then 05b** (roadmap-sanctioned).
- **05a Role RLS & integrity (L):** 05-01 (M) → 05-03 (M) → 05-04 (S) → 05-02 (L, includes the clinical split and P1-04 trigger part) → 05-06 (S) → 05-08 (M). Needs only V2-03 03-03 + 03-07; can be planned before V2-04 finishes. Gate: matrix + FKs + exclusion + counter + adversarial review.
- **05b Membership, invites & entitlements (L):** 05-09 (M-L, includes the test-seed change) → 05-05 (M) → 05-07 (M; needs V2-04) → 05-10 (L). Gate: acceptance 8-13 + full suite green + adversarial review (billing/auth).
- Why: each half stays reviewable by an isolated plus an adversarial reviewer; 05a is pure DB/authz with a low app blast radius except the clinical split; 05b concentrates the app-visible change (locked pages, guards, every test tenant). 05-07's dependency on V2-04 cannot stall the role work.

**Top risks:** (1) clinical split scope (about 18 app files, consult screen); mitigate by doing it first in 05-02 with a mirror trigger and a final contract migration. (2) RLS performance with stacked helpers; mitigate with `EXPLAIN (ANALYZE)` on visits/patients list queries in the evidence (SUB §7.2 asks for it). (3) The test suite going red at 05-10; mitigate by seeding in 05-09. (4) Overlap with V2-07 (check-in RPC, in-tx audit) and V2-09a (immutability); keep V2-05 to constraints, helpers and counters. (5) Hosted privilege differences (`auth.sessions`); V2-03 re-check, fallback documented. (6) Default privileges silently opening new tables; catalogue-loop pgTAP tests.

## Sources

### Primary (HIGH)
- Local stack catalogue (PG 17.11): `pg_policies`, `pg_constraint`, `pg_index`, `pg_proc`/`pg_get_functiondef`, `pg_default_acl`, `information_schema`, `storage.buckets`, `supabase_migrations.schema_migrations`. Probes (rolled back): exclusion constraint immutability and NOT VALID, composite FK SET NULL, RESTRICT under tenant cascade, GST generated column, pgTAP run, storage-policy user simulation.
- Repo: `lib/permissions/{matrix,index,guards}.ts`, `lib/auth/{tenant,tenant-refs}.ts`, `supabase/migrations/000001-000024`, `features/{staff,queue,billing,prescriptions,dpdp}/*`, `tests/helpers/tenants.ts`, `tests/setup/teardown.ts`, `.github/workflows/ci.yml`, `scripts/seed-local-dev.ts`, `scripts/phase-evidence.mjs`.
- Approved docs: V2_MASTER_ROADMAP §1.2, §10, §12.2 (V2-05); SUBSCRIPTIONS_AND_PLANS §4, §6, §7, §8, §11, §13; AI_STRATEGY §4.6, §6.2, §7; AUTH_REDESIGN §3.2, §3.6, §7, §9; ARCHITECTURE_DECISIONS ADR-006; BACKEND_MIGRATION_PLAN §3, §6, §12; SECURITY_VERIFICATION_PLAN §6.1; DATABASE_ASSESSMENT DB-01/03/08/09; VERIFICATION_LOG; 02-PLAN OA-4 (:492); 01A-04-AUTH00-SPIKE.

### Secondary (MEDIUM, official docs fetched 2026-11-13)
- https://supabase.com/docs/guides/database/postgres/row-level-security (initPlan wrapping, definer functions, `search_path=''`, exposed-schema warning, leading-index rule, `TO` clause)
- https://supabase.com/docs/guides/database/postgres/column-level-security (per-role privileges; not recommended; `select *` fails)
- https://supabase.com/docs/guides/database/testing (`supabase test db`, `supabase/tests/database/`, begin/plan/finish/rollback)
- https://www.postgresql.org/docs/17/sql-altertable.html (NOT VALID only for FK and CHECK; VALIDATE lock levels; ADD FOREIGN KEY locks)

### Tertiary (LOW)
- None used for recommendations.

## Metadata

**Confidence breakdown:**
- Current-state inventory: HIGH (live catalogue + files)
- Postgres mechanics (exclusion, FK, cascade, pgTAP): HIGH (probed)
- Role matrix, table subset, clinical split: MEDIUM (CTO defaults from the approved docs; PO confirmation recommended)
- V2-03/V2-04 interfaces: MEDIUM (forthcoming; named per the roadmap)

**Research date:** 2026-11-13. **Valid until:** about 2026-12-13, or until V2-03/V2-04 land (re-check the job API and the types path then).
