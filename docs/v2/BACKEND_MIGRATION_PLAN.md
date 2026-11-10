# clinicOS v2.0: Backend Migration Plan

**Workstream:** C · **Date:** 2026-11-10 · **Status:** Proposed plan. **Nothing in this document has been executed.** Every SQL statement below is for a future, approved implementation phase. The diagnostic queries in §3 are read-only and are to be run by the owner against a **staging copy or a read replica first**.
**Inputs:** `ARCHITECTURE_ASSESSMENT.md`, `DATABASE_ASSESSMENT.md`, `API_ASSESSMENT.md`, `TARGET_ARCHITECTURE.md`, `ARCHITECTURE_DECISIONS.md`.
**Sizing:** S/M/L/XL are relative. **Assumption:** 1–2 engineers, the existing test suite kept green, and Workstream E's local-DB harness available from Phase B onward.

---

## 1. Principles

1. **Contain first, refactor second.** P0 isolation defects are fixed as small patches on the current architecture before any restructuring.
2. **Expand → migrate → contract** for every schema change. Constraints are added `NOT VALID`, existing data is diagnosed and cleaned, then the constraint is `VALIDATE`d. Code switches over only after the expanded schema is live, and old structures are dropped in a later release.
3. **Strangler inside the monolith.** Domains move to the new contract one at a time. The old and new paths never write the same table with different rules for longer than one release.
4. **Every step is reversible** or explicitly marked **irreversible**, in which case it needs a verified backup and owner sign-off.
5. **Verification is part of the step.** A step is not done until its listed checks pass in CI and in staging.
6. **The database migrates before the app deploys** (backward-compatible migrations), and the app tolerates both old and new schema during the window.

---

## 2. Phase overview

| Phase | Goal | Steps | Size | Gate to next |
|---|---|---|---|---|
| **A: Containment (P0 hotfix)** | Close the tenant-isolation and escalation holes on v1 | A1–A7 | M (total) | Security re-test (Workstream D) passes; diagnostics (§3) reviewed |
| **B: Foundations** | Reproducible schema, CI, generated types, core primitives | B1–B8 | L | CI green on ephemeral DB; drift = 0 |
| **C: Data-integrity schema** | Database-enforced invariants (additive) | C1–C9 | L | All constraints VALIDATED in staging and production |
| **D: Data-access and transaction layer** | Kysely and `withTenantTx`; critical flows transactional | D1–D4 | L | Critical flows pass concurrency tests |
| **E: Domain refactor** | Contract per domain; REST on services | E1–E3 (per domain) | XL | Each domain: no direct DB access outside its repo |
| **F: Jobs and integrations** | Outbox, claim, scheduler, governance, retention | F1–F7 | L | Queue lag and duplicate-send tests pass |
| **G: API v1 hardening** | Scopes, RLS principal, rate limit, idempotency, generated OpenAPI | G1–G6 | M | Contract tests; backwards-compatible for existing keys |
| **H: Observability** | Logger, request IDs, Sentry, metrics | H1–H4 | M (can start in B) | Alerts fire in staging drills |

Phases B and H can run in parallel after A. Phase C precedes D for the affected tables. Phase E proceeds domain by domain in this order: **billing → consultation/prescriptions → visits/queue/waitlist → patients/consent → labs/documents/referrals → settings/staff → notifications/AI**. Risk and integrity value drive the order.

---

## 3. Read-only diagnostics (run before Phases A and C)

The owner runs these against staging first, then against production on a read-only connection. Record the counts in a findings note. **Any non-zero result in D1–D4 should be treated as a possible security incident and escalated to Workstream D before any cleanup.**

```sql
-- D0. Migration history actually applied (drift check vs repo 000001–000018)
select version, name from supabase_migrations.schema_migrations order by version;

-- D1. Cross-tenant references (DB-01). Repeat pattern for each child→parent pair.
select 'visits→patients' chk, count(*) from visits v join patients p on p.id = v.patient_id where v.tenant_id <> p.tenant_id
union all select 'invoices→visits', count(*) from invoices i join visits v on v.id = i.visit_id where i.tenant_id <> v.tenant_id
union all select 'prescriptions→visits', count(*) from prescriptions r join visits v on v.id = r.visit_id where r.tenant_id <> v.tenant_id
union all select 'diagnoses→visits', count(*) from consultation_diagnoses d join visits v on v.id = d.visit_id where d.tenant_id <> v.tenant_id
union all select 'documents→patients', count(*) from patient_documents d join patients p on p.id = d.patient_id where d.tenant_id <> p.tenant_id
union all select 'payments→invoices', count(*) from payments x join invoices i on i.id = x.invoice_id where x.tenant_id <> i.tenant_id
union all select 'queue_tokens→visits', count(*) from queue_tokens q join visits v on v.id = q.visit_id where q.tenant_id <> v.tenant_id
union all select 'comm_queue→patients', count(*) from communication_queue c join patients p on p.id = c.patient_id where c.tenant_id <> p.tenant_id;

-- D2. Share tokens pointing at another tenant's resource (ARC-05)
select t.resource_type, count(*) from document_share_tokens t
left join prescriptions r on t.resource_type='prescription' and r.id=t.resource_id
left join invoices i      on t.resource_type='invoice'      and i.id=t.resource_id
left join referrals f     on t.resource_type='referral'     and f.id=t.resource_id
left join patient_documents d on t.resource_type='patient_document' and d.id=coalesce(t.resource_id,t.document_id)
where coalesce(r.tenant_id,i.tenant_id,f.tenant_id,d.tenant_id) <> t.tenant_id
group by 1;

-- D3. Storage paths outside the owning tenant prefix (ARC-06)
select count(*) from patient_documents
where storage_path not like 'tenants/' || tenant_id || '/%' and storage_path not like tenant_id || '/%';

-- D4. Possible role escalation (RLS-01): memberships whose role differs from the consumed invitation,
--     and tenants with >1 owner (review each manually)
select m.tenant_id, m.user_id, i.role invited_role, m.role current_role
from memberships m join invitations i on i.tenant_id=m.tenant_id and i.consumed_by=m.user_id
where i.role <> m.role;
select tenant_id, count(*) owners from memberships where role='owner' group by 1 having count(*)>1;

-- D5. Clinician not a member of the visit's tenant (DB-02)
select count(*) from visits v where not exists
 (select 1 from memberships m where m.tenant_id=v.tenant_id and m.user_id=v.doctor_id);

-- D6. Overlapping non-overbooked scheduled appointments (DB-08)
select count(*) from visits a join visits b
  on a.tenant_id=b.tenant_id and a.doctor_id=b.doctor_id and a.id<b.id
 and tstzrange(a.scheduled_at, a.scheduled_at + make_interval(mins=>a.estimated_duration_minutes))
  && tstzrange(b.scheduled_at, b.scheduled_at + make_interval(mins=>b.estimated_duration_minutes))
where a.origin_type='scheduled' and b.origin_type='scheduled'
  and not a.is_overbooked and not b.is_overbooked
  and a.status not in ('cancelled','no_show') and b.status not in ('cancelled','no_show');

-- D7. Billing integrity (DB-10..12)
select count(*) dup_active_invoices from (select tenant_id, visit_id from invoices where status<>'cancelled' group by 1,2 having count(*)>1) s;
select count(*) bad_item_totals from invoice_items where total_price <> round(unit_price*quantity,2);
select count(*) bad_invoice_totals from invoices where total_amount <> greatest(subtotal-discount+tax,0);
select i.id from invoices i join payments p on p.invoice_id=i.id group by i.id, i.total_amount having sum(p.amount) > i.total_amount;
select count(*) non_standard_numbers from invoices where invoice_number !~ '^INV-\d{4}-\d{5}$';

-- D8. Status coherence (DB-15..17)
select count(*) from visits where status='completed' and signed_at is null;
select count(*) from visits where origin_type='scheduled' and scheduled_at is null;
select count(*) from patients where is_deleted <> (erased_at is not null) or status not in ('active','erased');
select count(*) from schedule_blocks where end_time <= start_time;

-- D9. Queue health / scheduler evidence (ARC-14)
select status, count(*), min(next_retry_at) from communication_queue group by 1;
select status, count(*), min(next_retry_at) from webhook_delivery_queue group by 1;

-- D10. Dead objects
select count(*) from consultations;  -- expected 0
select count(*) from patients where phone !~ '^\+[1-9][0-9]{7,14}$';
```

---

## 4. Phase A: Containment (P0/P1 hotfixes on v1)

Coordinate with Workstream D, which may already list these. Avoid duplicate tickets.

| Step | Change | Reversible? | Data risk | Verification | Size |
|---|---|---|---|---|---|
| **A1** | Remove `clientOverride`/`sessionOverride` from **all** `"use server"` exports. Move test seams to non-exported internal functions in a non-`"use server"` module. Fix the callers in `app/api/v1/**`, which pass overrides. | Yes (code) | None | (1) CI grep: no `"use server"` file exports a function with `Override` in its params. (2) Test calling `searchPatients` with a forged override returns unauthenticated or forbidden. (3) Existing UI flows smoke-tested. | M |
| **A2** | Migration: `REVOKE UPDATE (role, tenant_id, user_id) ON memberships FROM authenticated`; add `change_member_role(p_membership_id, p_role)` SECURITY DEFINER with owner-only rules and last-owner protection; switch `features/staff`/`settings` to the RPC. Also restrict invitations of `owner`/`admin` to owners. | Yes (re-grant) | None | pgTAP: receptionist `UPDATE memberships SET role` → permission denied; owner via RPC succeeds; admin cannot grant owner. Run diagnostic D4 and review. | S |
| **A3** | Share-token resolution: add `.eq("tenant_id", shareToken.tenant_id)` to every resource lookup in `app/api/r/[token]/route.ts` and `app/r/[token]/page.tsx`. Insert-time check that `resource_id` belongs to the tenant. | Yes | None | D2 = 0 for new tokens. Test that a forged cross-tenant token returns 404. | S |
| **A4** | `POST /api/v1/lab-orders`: require `storage_path` to start with `tenants/<tenantId>/`; validate the body with zod. | Yes | None | Test that a cross-tenant path returns 422. Run D3. | S |
| **A5** | SECURITY DEFINER hardening: `REVOKE EXECUTE … FROM PUBLIC, anon` on `generate_tenant_invoice_number`; add a membership check (`p_tenant_id IN (select current_user_tenant_ids())`) to it, to `generate_daily_queue_token` and to `search_medicines` (also enforce `p_doctor_id = auth.uid()` or same tenant). | Yes | None | pgTAP: calling with a foreign tenant raises an error. | S |
| **A6** | `PATCH /api/v1/visits/{id}`: reject clinical-field edits when `signed_at IS NOT NULL` (409) and reject `status=completed` unless the key principal maps to a doctor (interim rule). | Yes | None | Contract test. | S |
| **A7** | Fix the sign-off defects: select `patient_id, doctor_id` before emitting `visit.completed`; remove the update to non-existent `queue_tokens.updated_at`; check errors on each step and return a failure. | Yes | None | Unit and integration test of the webhook payload. | S |

**Rollback:** each step is an isolated PR or migration with a down script (re-grant, drop function). A1 has no schema impact.

---

## 5. Phase B: Foundations

| Step | Change | Reversible? | Verification | Size |
|---|---|---|---|---|
| **B1** | **Baseline and drift reconciliation.** Run `supabase db diff` / `pg_dump --schema-only` (read-only) on production versus a fresh `supabase db reset` from the repo. If there is drift, write migration `000019_reconcile_baseline.sql` (idempotent `IF NOT EXISTS` guards). | Yes | A diff of a fresh build against production is empty except for the documented exceptions | M |
| **B2** | **Migration immutability rule.** CI job fails if any file under `supabase/migrations/` that exists on `main` is modified. New migrations use timestamp names from now on. | Yes | CI test with an intentional edit fails | S |
| **B3** | **Ephemeral DB in CI.** `supabase start` → `db reset` → pgTAP (RLS per role × table × command, SECURITY DEFINER functions) → integration tests. Move seed reference data to `supabase/seed.sql` or a local-only loader, and refuse remote targets without `--remote --yes-really`. | Yes | CI run time and coverage report; zero tests hit the hosted project | M |
| **B4** | **Generated types.** `supabase gen types` to `lib/db/generated.ts`; keep `lib/db/types.ts` as domain aliases only; CI diff check. Reduce `as any` per domain as it is touched (tracked metric). | Yes | `tsc` passes; the `as any` count trends down | S |
| **B5** | **Core primitives** in `lib/core`: `Result`/`AppError`, Postgres error mapper, `RequestContext` with `React.cache`, `time` (tenant TZ), complete zod `env` (all about 30 vars, no silent fallbacks), and the `server-only` guard. | Yes | Unit tests | M |
| **B6** | **Boundary lint rules.** `no-restricted-imports` for `lib/supabase/admin` (allow-list), `"use server"` exports with one parameter, a ban on `toISOString().split("T")`. Fix the ESLint ignores for `.agents/`, `.opencode/` and `.next/` (coordinator fact). Start in warn mode, then switch to error per domain. | Yes | Lint is clean in migrated domains | S |
| **B7** | **Dependency upgrades:** next (latest 15.x patch), zod 4 (with codemods), `@supabase/ssr` latest, Renovate config. | Yes (lockfile) | Full test suite and smoke test | M |
| **B8** | **Single service-role factory** `getSystemDb(reason)`; delete the three duplicate factories (`lib/messaging/dispatcher.ts:33`, `features/appointments/actions.ts:10`, `features/auth/dev-actions.ts:38`). | Yes | grep shows one factory | S |

---

## 6. Phase C: Data-integrity schema (expand, validate)

Each step is a separate migration. "NV" means the constraint is added `NOT VALID` first, the relevant §3 diagnostic is run and cleaned up, and a follow-up migration runs `VALIDATE CONSTRAINT`.

| Step | Change | Existing-data impact and cleanup | Reversible? | Verification | Size |
|---|---|---|---|---|---|
| **C1** | `UNIQUE (tenant_id, id)` on parent tables (patients, visits, invoices, prescriptions, patient_documents, referrals, api_keys, webhook_subscriptions) | None; builds an index (use `CONCURRENTLY` through a separate non-transactional migration) | Drop constraint | Index exists | S |
| **C2** | Composite FKs `(tenant_id, X_id) → parent(tenant_id, id)` NV on every child; keep the old FKs until validated, then drop them | D1 must be 0. Non-zero rows: investigate (D: incident?), then correct `tenant_id` or quarantine the rows to an `integrity_quarantine` schema | Drop new FKs | `VALIDATE` succeeds; pgTAP cross-tenant insert fails | M |
| **C3** | `prescription_items.tenant_id` add, backfill, `NOT NULL`, composite FK, direct RLS | Backfill from the parent (single UPDATE) | Drop column | Row counts match; RLS tests | S |
| **C4** | CASCADE → RESTRICT on clinical and financial children of patients and visits; drop `visits_delete_member` policy | None (DDL). Behaviour change: deletes now fail | Restore the previous FKs | Test that deleting a visit with an invoice fails; UI uses cancel | S |
| **C5** | CHECKs: money (DB-11), durations and status coherence (DB-15), schedule blocks (DB-14), status vocabularies (DB-16), patient erasure coherence (DB-17), phone E.164 (DB-18). All NV | D7, D8, D10 cleanup scripts reviewed by the owner. Money mismatches are **not** auto-corrected: list them for the clinic | Drop constraints | `VALIDATE` succeeds | M |
| **C6** | Counter tables: `queue_token_counters(tenant_id, date)` and `invoice_sequences(tenant_id, fy)`; new SECURITY INVOKER RPCs `next_queue_token()` and `next_invoice_number()` that derive the tenant from context; old functions kept until Phase E switches callers | Seed counters from the current `MAX` per tenant and day or year. Invoice series format change starts at cutover (**Assumption (validate):** owner chooses `INV/2026-27/00001` vs keeping `INV-YYYY-#####`) | Drop tables; callers revert | Concurrency test: 50 parallel check-ins produce 50 distinct tokens with no errors | S |
| **C7** | `btree_gist` + appointment **exclusion constraint** (DB-08) | D6 must be 0. Otherwise mark historical overlaps `is_overbooked = true` with an audit entry, or scope the constraint to `scheduled_at >= <cutover>` | Drop constraint | Concurrency test: parallel booking of the same slot gives one success and one 409 | M |
| **C8** | Partial unique index: one non-cancelled invoice per visit (DB-12) | D7 duplicates are resolved manually (cancel extras) **with the clinic's agreement** | Drop index | Insert of a second active invoice fails | S |
| **C9** | `set_updated_at()` triggers; add missing `updated_at`; trigram indexes (patients name and phone); missing FK indexes; drop redundant indexes; fix the comm-queue partial index; storage policy cast fix | None | Drop | `EXPLAIN` shows index use for search | S |

**Immutability (DB-13/ADR-015)** is deliberately **not** in Phase C. It ships with the refactored consultation amendment service in Phase E (step E2-consultation), because enabling it earlier would break the v1 amendment flow.

---

## 7. Phase D: Data-access and transaction layer

| Step | Change | Reversible? | Verification | Size |
|---|---|---|---|---|
| **D1** | **Spike (time-boxed).** Kysely + `pg` through Supavisor transaction mode; `withTenantTx` applying `SET LOCAL ROLE authenticated` and `request.jwt.claims`. Measure latency against supabase-js and confirm that `auth.uid()` and RLS behave identically. Decide between ADR-003 and its fallback (RPC-per-flow) | n/a | Written spike report; RLS pgTAP suite passes through the Kysely path | S |
| **D2** | `lib/db`: pool, `withTenantTx`, `withSystemTx(reason)`, error mapper, `kysely-codegen` in CI | Yes | Unit and integration tests | M |
| **D3** | **Transactional critical flows** (behind the existing action signatures): invoice create, payment, sign-off (+audit+outbox), amendment, check-in, waitlist promote, booking (catch 23P01 → `SLOT_TAKEN`) | Yes, with a feature flag per flow (`TX_<FLOW>=on`) and the old path kept for one release | Concurrency tests (parallel payments, double-booking, check-in storms); fault injection (fail the 2nd statement → nothing persisted) | L |
| **D4** | Audit inside the transaction: `audit.record(tx, ctx, …)`; DB trigger forces `actor_id`; revoke direct INSERT from `authenticated` once all writers are migrated | Re-grant | Audit row exists for each committed command and none for rolled-back ones | S |

---

## 8. Phase E: Domain refactor (repeat per domain)

| Step | Per-domain checklist | Verification |
|---|---|---|
| **E1: Contract** | Create `schema.ts` (zod v4 DTOs), `policy.ts`, `repo.ts` (Kysely), `service.ts` (Result, one tx per command), `queries.ts`, `jobs.ts`; `actions.ts` becomes a thin adapter with exactly one validated param; move any remaining logic out of `app/**` | Lint boundary rule at error level for the domain; service unit tests ≥ agreed coverage (Workstream E) |
| **E2: Domain-specific** | **billing:** FY numbering, overpayment rules, receipt PDF as a job. **consultation:** amendment RPC + **immutability triggers (ADR-015)**, archival PDF job. **visits/queue/waitlist:** merge `features/appointments` into the visits service (system context for webhook-driven reschedules), tenant TZ. **patients:** search with trigram, DTO without internal fields, erasure state machine. **labs/documents/referrals:** typed share-token FKs (DB-05) via a new table and dual-write for one release, then switch the reader, then drop the polymorphic columns; referral target RPCs (RLS-06). **settings/staff:** role-change RPC. **notifications/AI:** server-side context assembly, quotas | Domain integration tests on the ephemeral DB; parity tests comparing old and new outputs for read paths |
| **E3: REST adapters** | `app/api/v1/<resource>` handlers call the domain `api.ts` through `withApi`; delete the duplicated logic | v1 contract tests unchanged (backward compatible), except documented security fixes |

**Role-aware RLS (ADR-006):** add the `role_permissions` table and `has_permission()` early in Phase E. Switch each domain's policies when that domain is refactored (its pgTAP matrix is updated at the same time).

---

## 9. Phase F: Jobs and integrations

| Step | Change | Data risk | Verification | Size |
|---|---|---|---|---|
| **F1** | `jobs` table, `claim_jobs()` (SKIP LOCKED + lease), `complete_job()`/`fail_job()`; add `processing` and `locked_until` to the two delivery tables; recover stale `processing` rows | None (additive) | Parallel dispatcher test produces zero duplicate sends | M |
| **F2** | Scheduler: pg_cron + pg_net (or Vercel Cron per Workstream F) calls `/api/jobs/run` every minute with a rotating secret; **remove inline `dispatchPendingQueue` from `enqueueMessage`** and the fire-and-forget webhook import; optional `after()` kick | None | D9 shows no stale rows; lag p95 < 2 min in staging | S |
| **F3** | Enqueue inside the business tx (communication, webhook, jobs) | None | Fault injection: business rollback means no queued message | S |
| **F4** | Governance at enqueue and send: opt-out, consent, quiet hours (tenant TZ), monthly quota (increment in the send tx) | Messages previously sent despite opt-out cannot be recalled; release note | Unit and integration tests; quota counter matches sent count | S |
| **F5** | Webhooks: `redirect: 'manual'`, resolved-IP pinning, `webhook-id` header, auto-disable after N failures, encrypted secret storage (Vault) and show-once | **Re-encryption of existing secrets** (one-off migration job; keep the plaintext column until verified, then null it) | Signature vectors unchanged for consumers | M |
| **F6** | Retention jobs (DB-21): queue PII nulling (90 days), webhook payload purge (30 days), expired token and invitation purge, usage roll-ups | **Irreversible deletes:** dry-run report first, owner sign-off, PITR window confirmed | Dry-run counts match expectations; purged rows audited (counts only) | M |
| **F7** | Erasure state machine (DB-22): restriction now (revoke tokens, cancel queued messages, hide); anonymisation job after the retention period | **Irreversible:** legal confirmation of periods (Workstream D), backup verified, feature flag | End-to-end test on synthetic patients only | M |

---

## 10. Phase G: API v1 hardening

| Step | Change | Compatibility | Verification | Size |
|---|---|---|---|---|
| **G1** | `withApi` pipeline (auth, rate limit, zod, idempotency, error mapping, logging) | Same envelope | Contract tests | S |
| **G2** | `api_authenticate()` RPC: key lookup + minute-bucket rate limit + daily usage in one round trip (replaces the in-memory limiter and the racy counter) | Same headers | Load test: global limit enforced across 2+ instances | S |
| **G3** | API keys: `scopes[]`, `expires_at`, service principal; existing keys get **full scopes** (no breakage); new keys default to read-only; keys auto-revoked or flagged when the creator's membership ends | Backward compatible | Scope matrix tests | M |
| **G4** | Run v1 requests through `withTenantTx` under the key principal (RLS backstop) | Transparent | pgTAP plus API tests with RLS denial | M |
| **G5** | `Idempotency-Key` support (optional in v1; required in v2) | Additive | Retry test returns the identical response and no duplicate row | S |
| **G6** | DTO allow-lists (remove internal fields from responses); OpenAPI 3.1 generated from zod, including webhook events; fix the `x-api-key` and `gender` drift | **Field removals are breaking:** announce, keep removed fields in v1 for 90 days if any integrator depends on them (**Assumption (validate):** number of active integrators) | Generated spec matches routes; drift test | M |

---

## 11. Phase H: Observability (can start alongside Phase B)

| Step | Change | Verification | Size |
|---|---|---|---|
| H1 | pino logger with redaction; replace `console.*` per domain (lint rule) | Log sample review: no PHI fields | M |
| H2 | `x-request-id` from middleware into the context, logs, error envelopes and job payloads | Trace a request end to end in staging | S |
| H3 | Sentry with scrubbing, release tagging, source maps | Synthetic error appears without PHI | S |
| H4 | `/api/ready`: queue lag, dead letters, scheduler heartbeat; uptime monitor and alerts | Staging drill: stop the scheduler and an alert fires | S |

---

## 12. Data-migration risk register

| Risk | Where | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Hosted schema differs from the repo (edited migrations 000007 and 000014) | B1 | Medium | High: later migrations fail or behave differently | Baseline diff before any Phase C migration; reconcile migration |
| Cross-tenant references or tokens found (evidence of exploitation) | D1–D3, C2 | Low–Medium | High: a reportable breach under DPDP | Treat as an incident; preserve evidence before cleanup; Workstream D leads |
| Existing overlapping appointments block the exclusion constraint | C7 | Medium | Medium | Mark as overbooked with an audit note, or scope by cutover date |
| Duplicate active invoices or bad totals | C5, C8 | Medium | Medium: financial records | Never auto-fix amounts; the clinic reviews; cancel duplicates with an audit trail |
| CASCADE→RESTRICT surfaces hidden delete paths | C4 | Low | Medium | Search code for `.delete()` on parents first; staging soak |
| Immutability triggers break legitimate edits | E2 (consultation) | Medium | High (clinical workflow) | Ship with the amendment RPC; feature flag; staging UAT with doctors |
| Invoice numbering change confuses clinics or accountants | C6 | Medium | Low–Medium | Owner decision on format; release note; old numbers untouched |
| Queue tokens historically bucketed in UTC | C6, ADR-016 | Certain | Low | Document; do not rewrite history |
| Webhook secret re-encryption loses secrets | F5 | Low | Medium (integrations break) | Keep plaintext until encrypted values are verified; rollback by reading plaintext |
| Retention or erasure deletes data too early | F6–F7 | Low | **Critical, irreversible** | Legal sign-off, dry runs, PITR confirmation, two-person approval |
| Kysely/RLS-context performance or pooler limits | D1–D3 | Low–Medium | Medium | Spike first; fallback to the RPC-per-flow approach (ADR-003 alternative a) |
| Removing override params breaks tests | A1 | Certain | Low | Tests move to the service layer (Workstream E) |

---

## 13. Definition of done (backend v2 readiness)

- [ ] No `"use server"` export takes override parameters; there is one service-role factory with an allow-list.
- [ ] Every table has role-aware RLS where the data is clinical; the pgTAP matrix passes in CI.
- [ ] Composite tenant FKs and the integrity constraints are **validated** in production.
- [ ] Every write command is a single transaction including audit and outbox; there are concurrency tests for the critical flows.
- [ ] Generated DB types; `as any` reduced to a tracked, justified minimum (target < 20).
- [ ] REST v1 handlers call domain services; OpenAPI is generated and drift-tested.
- [ ] The jobs scheduler is live; no inline dispatch; zero duplicate sends in tests; governance enforced.
- [ ] Retention and erasure jobs are approved and running (or explicitly deferred with a risk acceptance).
- [ ] Structured logs with request IDs, Sentry, queue-lag alerts.
- [ ] Migrations are reproducible from scratch in CI and the drift check is clean.
