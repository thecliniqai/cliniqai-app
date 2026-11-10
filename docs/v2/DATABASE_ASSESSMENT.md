# clinicOS v2.0: Database Assessment

**Workstream:** C2 (Database and Data Integrity) · **Date:** 2026-11-10 · **Status:** Discovery only.
**Method:** Static reading of all 18 migrations in `supabase/migrations/` and the code that uses them. **No database connection was made.** Every statement about the hosted database is an *Assumption (validate)* until it is checked with the read-only queries in `BACKEND_MIGRATION_PLAN.md §3`.
**Labels:** Fact / Problem / Risk / Assumption (validate) / Recommendation · Priority P0–P3 · Size S/M/L/XL.

---

## 1. Summary

The schema is a reasonable first cut of a multi-tenant clinic model:
- UUID primary keys, `tenant_id` on almost every row, RLS enabled on every table created by migrations
- `CHECK`-constrained status vocabularies
- append-only consent and revision tables
- tenant-prefixed composite indexes for the main access paths

The weaknesses are what you would expect from schema-by-feature-phase without a DBA pass:

- **Tenant consistency of references is not enforced** (`visits.patient_id` can point to another tenant's patient).
- **Business invariants live only in TypeScript**: no double-booking protection, no money arithmetic checks, no signed-record immutability, and sequence numbers generated with `MAX/COUNT + 1`.
- **RLS is tenant-wide, never role-aware**, and one policy allows role self-escalation (P0).
- **Migrations have been edited in place**, and one creates a dead table. Types are hand-written and incomplete.
- **There is no retention or erasure execution.** "Erasure" is a boolean flag; PII remains in place and is replicated into queue tables.

---

## 2. Schema inventory

44 tables are created by migrations. `prescriptions` was created twice; `000007` drops and re-creates it.

| Domain | Table | Tenant col | Key relationships | Introduced |
|---|---|---|---|---|
| Tenancy | `tenants` | (is tenant) | — | 000001, extended 000002/07/09/18 |
| | `memberships` | ✓ | `user_id→auth.users` CASCADE, `tenant_id→tenants` CASCADE, UNIQUE(user_id, tenant_id) | 000001, extended 000007/10/12 |
| | `invitations` | ✓ | `created_by/consumed_by→auth.users` | 000002 |
| SaaS billing | `subscriptions` (1 per tenant), `payment_records` | ✓ | — | 000002 |
| Patients | `patients` | ✓ | `created_by→auth.users` | 000003, extended 000004/06/14/18 |
| | `consent_records` (append-only) | ✓ | `patient_id` CASCADE | 000003 |
| Compliance | `audit_logs` (BIGSERIAL, append-only) | ✓ | `actor_id→auth.users`, `api_key_id→api_keys` | 000003, 000018 |
| Dead | `consultations` | ✓ | `patient_id` | 000004. **Never used by code** (no `.from("consultations")`) |
| Scheduling | `visits` (appointment, walk-in, consultation, SOAP, vitals) | ✓ | `patient_id` CASCADE, `doctor_id/created_by/signed_by→auth.users` | 000006, extended 000007/15 |
| | `queue_tokens` | ✓ | `visit_id` UNIQUE CASCADE, UNIQUE(tenant_id, date, token_number) | 000006 |
| | `waitlist_entries` | ✓ | `patient_id`, `doctor_id`, `promoted_visit_id` | 000006 |
| | `schedule_blocks` | ✓ | `doctor_id→auth.users` (NULL = clinic-wide) | 000012 |
| Clinical | `consultation_diagnoses` | ✓ | `visit_id`, `patient_id` CASCADE | 000007 |
| | `prescriptions` (versioned) | ✓ | `visit_id`, `patient_id` CASCADE; UNIQUE(tenant_id, visit_id, version) | 000007 |
| | `prescription_items` | **✗ (no tenant_id)** | `prescription_id` CASCADE | 000007 |
| | `doctor_custom_medicines`, `doctor_custom_diagnoses`, `doctor_prescription_templates` | ✓ | `doctor_id→auth.users` | 000007 |
| | `visit_revisions` (append-only) | ✓ | UNIQUE(visit_id, revision_number) | 000007 |
| | `follow_ups` | ✓ | `visit_id` SET NULL | 000007 |
| Reference | `cdci_*` (8 tables), `opd_diagnoses` | global | Text primary keys, **no FKs between cdci tables** | 000007 |
| Patient billing | `invoices` | ✓ | `visit_id`, `patient_id` CASCADE; UNIQUE(tenant_id, invoice_number) | 000009 |
| | `invoice_items`, `payments` | ✓ | `invoice_id` CASCADE | 000009 |
| Documents | `patient_documents` | ✓ | `visit_id` SET NULL | 000013 |
| | `document_share_tokens` | ✓ | `document_id` nullable; polymorphic `resource_type/resource_id` (**no FK**) | 000013, 000014 |
| | `referrals` | ✓ | `target_tenant_id→tenants`, `target_doctor_id` | 000013 |
| Comms | `communication_queue`, `tenant_messaging_config`, `in_app_notifications` | ✓ | `appointment_id→visits` | 000014, 000016 |
| Integrations | `api_keys`, `api_key_usage_daily`, `webhook_subscriptions`, `webhook_delivery_queue` | ✓ | — | 000018 |
| Storage | buckets `prescriptions` (PDF, 10 MB), `clinic-records` (PDF/images, 25 MB) | path-prefix | `storage.objects` policies | 000008, 000013 |

**Functions:**
- `current_user_tenant_ids()` (SECURITY DEFINER, STABLE)
- `current_user_is_admin_or_owner(uuid)` (SECURITY DEFINER)
- `create_clinic_with_owner(text)`, `consume_invitation(text)`
- `generate_daily_queue_token(uuid, date)`, `generate_tenant_invoice_number(uuid)`, `search_medicines(…)` (all SECURITY DEFINER)
- `get_tenant_table_rls_policies()` (service_role only; only covers the first 8 tables, `000005:31-40`)
- `normalize_indian_phone_e164(text)`

**Triggers:** none. `updated_at` is maintained by application code where it is maintained at all.
**Extensions:** `pg_trgm` (`000007:5`).

### Entity relationship (core clinical path)
```
tenants 1─* memberships *─1 auth.users
tenants 1─* patients 1─* visits 1─1 queue_tokens
                       │     ├─* consultation_diagnoses
                       │     ├─* prescriptions 1─* prescription_items
                       │     ├─* visit_revisions
                       │     ├─* invoices 1─* invoice_items
                       │     │            └─* payments
                       │     └─* patient_documents ─* document_share_tokens (+ polymorphic resource_id)
                       ├─* consent_records, follow_ups, referrals, waitlist_entries, communication_queue
visits.doctor_id / prescriptions.doctor_id / … ──► auth.users   (NOT memberships; no tenant check)
```

---

## 3. Referential integrity

### Facts
- All child tables reference parents by `id` only. For example, `visits.patient_id REFERENCES patients(id)` (`000006:15`) and `invoices.visit_id/patient_id` (`000009:15-16`). Nothing makes `child.tenant_id = parent.tenant_id`.
- Clinician columns (`visits.doctor_id`, `prescriptions.doctor_id`, `schedule_blocks.doctor_id`, `referrals.referring_doctor_id`, `waitlist_entries.doctor_id`, …) reference `auth.users`, not the tenant's membership.
- FK checks in Postgres bypass RLS. A tenant-A user inserting a visit with `tenant_id = A` and a `patient_id` belonging to tenant B passes both the FK and RLS `WITH CHECK`.
- `invoices` has redundant `patient_id` and `visit_id`, and nothing ensures `invoice.patient_id = visit.patient_id`. The same applies to `consultation_diagnoses`, `prescriptions` and `patient_documents`.
- `document_share_tokens.resource_id` is polymorphic with no FK (`000014:140-143`).
- `prescription_items` has no `tenant_id`. Its RLS relies on a sub-select on `prescriptions` (`000007:409-438`).
- `ON DELETE CASCADE` from `patients` and `visits` to clinical and financial records (invoices, payments, prescriptions) is inconsistent with "patients must never be hard-deleted" (`000003:87`) and with statutory retention. The only thing preventing loss is the absence of a DELETE policy; any service-role delete cascades. Visits **do** have a DELETE policy for owner/admin (`000006:123-130`), which cascades to prescriptions, invoices and payments.

### Problems and recommendations
| ID | Problem | Priority | Recommendation |
|---|---|---|---|
| DB-01 | Cross-tenant references are possible (data-integrity and isolation defect) | **P1** | Add `UNIQUE (tenant_id, id)` on parent tables. Replace child FKs with composite `(tenant_id, parent_id) REFERENCES parent(tenant_id, id)`, created `NOT VALID` and then `VALIDATE` after the diagnostic query shows zero violations. Size M. |
| DB-02 | Clinicians reference `auth.users`, not tenant membership | P2 | A composite FK `(tenant_id, doctor_id) → memberships(tenant_id, user_id)` (unique already exists as `(user_id, tenant_id)`; add the reversed-order unique or reference it as-is). Note: when a doctor leaves, the membership row must be retained (soft-deactivate) rather than deleted. |
| DB-03 | Cascade deletes can destroy financial and clinical history | **P1** | Change `ON DELETE CASCADE` to `RESTRICT` on clinical and financial children of `patients` and `visits`. Remove the `visits_delete_member` policy and replace it with status `cancelled`. Keep CASCADE only from `tenants` for an explicit, audited tenant-offboarding procedure. |
| DB-04 | Redundant `patient_id` on visit-children can disagree | P2 | Add a composite FK `(tenant_id, visit_id, patient_id) → visits(tenant_id, id, patient_id)`, or drop the redundant column in v2 read models. |
| DB-05 | Polymorphic share-token resource | P1 | Use typed nullable FKs (`patient_document_id`, `prescription_id`, `invoice_id`, `referral_id`) plus a `CHECK (num_nonnulls(...) = 1)`, all composite with `tenant_id`. |
| DB-06 | `prescription_items` lacks `tenant_id` | P2 | Add `tenant_id` (backfill from the parent), a composite FK and a direct RLS policy. |
| DB-07 | `cdci_brands` has no FKs to its master tables | P3 | Add FKs or document it as a denormalised import. It is read-only reference data. |

> Verification (2026-11-10): PARTIALLY_CONFIRMED — DB-05: prescriptions, referrals and lab documents leak cross-tenant; invoice PDFs do not. H/P0 (ruling C11). See VERIFICATION_LOG.md

---

## 4. Indexes

### Facts
- Good tenant-prefixed composites exist for the main lists: patients (`000003:19-22`), visits (`000006:36-39`), invoices and payments (`000009:55-60`), documents, referrals and comms.
- **Patient search** uses `ILIKE '%…%'` on `full_name`, `phone` and `abha_id` (`features/patients/actions.ts:223`). Only B-tree indexes exist, so every search scans the tenant's patients.
- **FK columns with no leading index:**
  - `waitlist_entries.patient_id/doctor_id/promoted_visit_id`
  - `follow_ups.visit_id`
  - `document_share_tokens.document_id/resource_id`
  - `communication_queue.patient_id/appointment_id/recipient_user_id`
  - `referrals.referring_doctor_id/target_doctor_id/closed_by`
  - `payments.recorded_by`
  - `patient_documents.uploaded_by`
  - `schedule_blocks.created_by`
  - `api_keys.created_by`
  - `invitations.created_by/consumed_by`
  - `patients.created_by`
  - `audit_logs.actor_id`
  - every `*.patient_id` whose only index is `(tenant_id, patient_id)` (that index serves tenant-scoped queries but not cascade or `RESTRICT` checks from `patients`)
- **Redundant indexes** (a UNIQUE constraint already creates one):
  - `idx_invitations_token_hash` (`000002:26`)
  - `idx_subscriptions_tenant_id` (`000002:40`)
  - `idx_api_keys_hash` (`000018:18`)
- The dispatcher queries `status IN ('pending','failed')` (`lib/messaging/dispatcher.ts:132`), but the partial index covers `('pending','processing')` (`000014:35-37`).
- Clinic-wide day views query visits by `(tenant_id, scheduled_at)` with no doctor filter. The existing index leads with `doctor_id` after `tenant_id`.
- `audit_logs(entity_type, entity_id)` lacks `tenant_id` (`000003:38`).

### Recommendations (P2, S, all additive and safe with `CREATE INDEX CONCURRENTLY`)
1. `CREATE INDEX … ON patients USING gin (full_name gin_trgm_ops)`, and the same on `phone`. Optionally add a normalised `phone_digits` generated column.
2. `visits (tenant_id, scheduled_at)` partial `WHERE status NOT IN ('cancelled','no_show')`.
3. Fix the `communication_queue` partial index to match the dispatcher predicate (or change the predicate; see ADR-009).
4. Add indexes on FK columns used for joins or deletes. Skip pure `auth.users` audit columns unless user deletion is supported.
5. Drop the three redundant indexes.
6. `audit_logs (tenant_id, entity_type, entity_id, occurred_at DESC)`.

**Outstanding investigation:** confirm with `pg_stat_user_indexes` and `pg_stat_statements` on the hosted DB (read-only) before adding more.

---

## 5. Constraints and invariants

| ID | Invariant | Current enforcement | Priority | Recommendation |
|---|---|---|---|---|
| DB-08 | **No double-booking** of a doctor's slot | App check-then-insert (`features/visits/scheduling.ts:254-370`); a race allows duplicates. `is_overbooked` is a deliberate override | **P1** | `btree_gist` exclusion constraint: `EXCLUDE USING gist (tenant_id WITH =, doctor_id WITH =, tstzrange(scheduled_at, scheduled_at + make_interval(mins => estimated_duration_minutes)) WITH &&) WHERE (origin_type='scheduled' AND NOT is_overbooked AND status NOT IN ('cancelled','no_show'))`. Run the diagnostic for existing overlaps first. |
| DB-09 | Daily queue token sequence | `MAX+1` SECURITY DEFINER RPC (`000006:76-92`) plus UNIQUE. Concurrent check-ins fail | P1 | Per-tenant-per-day counter table updated with `INSERT … ON CONFLICT DO UPDATE SET n = n+1 RETURNING n` inside the check-in transaction. Compute the date in the tenant time zone in SQL. |
| DB-10 | Invoice numbering: gapless, per **Indian financial year** (Apr–Mar, as GST requires) | `count(*)+1` with **calendar year** (`000009:72-81`), plus an app fallback `INV-YYYY-<timestamp tail>` (`features/billing/actions.ts:93`) | P1 | `invoice_sequences(tenant_id, fy)` counter row incremented in the invoice transaction. Format `INV/2026-27/00001` (configurable prefix). Existing numbers are kept. **Assumption (validate):** whether clinics need GST-compliant invoices (GSTIN is collected: `000018:181`). |
| DB-11 | Money arithmetic | App-computed (`features/billing/actions.ts:60-76`). No CHECKs except `quantity>0` and `payment.amount>0` | P1 | CHECKs: `unit_price >= 0`, `total_price = unit_price*quantity`, `discount >= 0`, `tax >= 0`, `total_amount = GREATEST(subtotal - discount + tax, 0)`. Paid status derived in the payment transaction under `SELECT … FOR UPDATE`, rejecting overpayment and payments on `cancelled` or `draft` invoices. |
| DB-12 | One active invoice per visit | None (`features/billing/actions.ts:958-975` has fallback lookups, which suggests multiples exist) | P2 | Partial unique index `(tenant_id, visit_id) WHERE status <> 'cancelled'`. Check existing duplicates first. |
| DB-13 | **Signed clinical records are immutable** | None. Visits, prescriptions, items and diagnoses stay UPDATE/DELETE-able by any member after `signed_at`. The REST API overwrites notes on completed visits (`app/api/v1/visits/[id]/route.ts:150-165`) | **P1** | BEFORE UPDATE/DELETE triggers rejecting changes when `signed_at IS NOT NULL`, except through the amendment function (session flag `app.amendment_id` set by `reopen_visit_for_amendment` RPC). Same for `prescription_items` of signed prescriptions. |
| DB-14 | Schedule block validity | None | P2 | `CHECK (end_time > start_time)`. |
| DB-15 | Visit duration and status coherence | None | P2 | `CHECK (estimated_duration_minutes BETWEEN 5 AND 480)`. `CHECK (origin_type <> 'scheduled' OR scheduled_at IS NOT NULL)`. `CHECK (status <> 'completed' OR signed_at IS NOT NULL)`. Validate existing data first. |
| DB-16 | Status vocabularies | `CHECK (status IN …)` on most tables. **Missing** on `webhook_delivery_queue.status` (`000018:129`), `patients.status` (nullable TEXT, `000018:171`), `memberships.default_specialty`, `doctor_*_templates.specialty` | P2 | Add CHECKs. Keep TEXT+CHECK rather than Postgres ENUM (easier to evolve, as 000016 shows), and generate TS unions from a single source. |
| DB-17 | `patients.is_deleted` vs `status` vs `erased_at` triple | Three columns, no coherence | P2 | `CHECK ((is_deleted = (erased_at IS NOT NULL)) AND (status IN ('active','erased','merged')))`. Longer term, use `status` plus `erased_at` only. |
| DB-18 | Phone format | App only. 000017 normalised existing rows, but landlines fall back to raw input (`000017:32-33`) | P3 | `CHECK (phone ~ '^\+[1-9][0-9]{7,14}$')` added `NOT VALID`; find and fix the offenders, then validate. |
| DB-19 | `updated_at` freshness | Manual in some writes only | P2 | A generic `set_updated_at()` BEFORE UPDATE trigger on all mutable tables. Add `updated_at` where it is missing (`queue_tokens`, `payments`, `follow_ups`, …). |
| DB-20 | Invitations: role and recipient | Admin can invite `owner` (`000002:15,76-87`). `consume_invitation` does not compare `invited_address` with the consuming user's email or phone (`000002:136-161`) | P1 (defer to D) | Restrict the owner/admin grant to owners. Compare `invited_address`. Unique pending invite per address per tenant. |

> Verification (2026-11-10): PARTIALLY_CONFIRMED — DB-10/DB-11: confirmed; the race comes from `count+1`, and the fallback adds gaps and collisions. H/P1. See VERIFICATION_LOG.md

> Verification (2026-11-10): PARTIALLY_CONFIRMED — DB-13: confirmed, except DELETE is limited to owner/admin; `saveConsultationDraft` has no guard on completed visits. H/P1. See VERIFICATION_LOG.md

---

## 6. Row-Level Security review

**Coverage. Fact:** Every table created in the migrations has `ENABLE ROW LEVEL SECURITY`; there are 51 ENABLE statements. The reference tables are readable by any `authenticated` user (`000007:527-535`). No table was found without RLS. **Assumption (validate):** no tables were created outside migrations on the hosted DB (see §8).

| ID | Policy issue | Evidence | Priority | Recommendation |
|---|---|---|---|---|
| RLS-01 | User can UPDATE their own `memberships` row, including `role` and `tenant_id` | `000011:26-39` | **P0** | Column-level `REVOKE UPDATE` plus a SECURITY DEFINER `change_member_role()` RPC; self-update limited to profile columns. |
| RLS-02 | All clinical policies are tenant-only; role matrix not enforced in DB | `000006:104-188`, `000007:367-524`, `000009:94-128`, `000013:110-119` | P1 | `has_permission(tenant_id, 'consultations:view')` based on `role_permissions` table; role-aware SELECT and UPDATE on clinical tables. |
| RLS-03 | `FOR ALL` policies allow DELETE for every member on `patient_documents`, `document_share_tokens`, `communication_queue`, `in_app_notifications`, `tenant_messaging_config`, `doctor_custom_*`, `doctor_prescription_templates`, `referrals` | `000013:110-119,145-154,207-216`, `000014:45-54,80-89,117-126` | P1 | Split into per-command policies. DELETE only where business-justified, and soft-delete clinical documents. |
| RLS-04 | `in_app_notifications` visible to all tenant members regardless of `recipient_user_id/role` | `000014:117-126` | P2 | `USING (tenant ok AND (recipient_user_id = (select auth.uid()) OR recipient_role = my_role(tenant_id)))`. |
| RLS-05 | `audit_logs` INSERT accepts any `actor_id` | `000003:91-97` | P2 | Trigger forces `actor_id := auth.uid()` for `authenticated`; or revoke INSERT and write from SECURITY DEFINER `record_audit()`. |
| RLS-06 | Referral target can UPDATE any column, including `tenant_id` | `000013:230-242` | P1 | RPC `acknowledge_referral` / `close_referral`; drop the broad UPDATE policy. |
| RLS-07 | `patients` SELECT doesn't hide erased rows | `000003:64-68` | P2 | Policy `AND NOT is_deleted` for normal roles; erased-record access via a privileged compliance function. |
| RLS-08 | Policy performance: `auth.uid()` not wrapped in `(select …)`; `EXISTS (SELECT … memberships …)` repeated per row in owner/admin policies | `000002:66-117`, `000018:29-166` | P2 | Use `(select auth.uid())` and the existing STABLE helpers (`current_user_is_admin_or_owner`) consistently, as Supabase's RLS performance guidance recommends. |
| RLS-09 | Tenant scoping is "any tenant I belong to", not "active tenant" | `current_user_tenant_ids()` | P3 | Acceptable. App queries add `.eq("tenant_id", active)`. Document it. Optionally set `app.active_tenant` in the transaction context in the target design. |
| RLS-10 | Storage policies: `split_part(name,'/',1)::uuid` inside `OR` may raise an error for `tenants/…` paths; no DELETE policy on `prescriptions` bucket; R2 path bypasses storage RLS entirely | `000013:31-79`, `000008:28-54`, `lib/storage/index.ts:64-75` | P2 | Rewrite with a safe `CASE` or a regex guard before the cast. Single provider (ADR-014). |
| RLS-11 | RLS self-test RPC covers only 8 of 44 tables | `000005:31-40` | P2 | Replace with pgTAP tests run in CI against a local Supabase (`TARGET_ARCHITECTURE.md §11`). |

> Verification (2026-11-10): PARTIALLY_CONFIRMED — RLS-01: self-promotion confirmed (Cr/P0); `tenant_id` can move only to a tenant the user already belongs to (WITH CHECK in `000011`). See VERIFICATION_LOG.md

**SECURITY DEFINER inventory:**

| Function | Membership check | Grants | Verdict |
|---|---|---|---|
| `current_user_tenant_ids` | n/a (uses `auth.uid()`) | default | OK; pin `search_path` (done) |
| `current_user_is_admin_or_owner` | uses `auth.uid()` | default | OK |
| `create_clinic_with_owner` | `auth.uid()` | authenticated only | OK; consider a rate limit (clinic spam) |
| `consume_invitation` | `auth.uid()` | authenticated only | Missing address match (DB-20) |
| `generate_daily_queue_token` | **none** | authenticated, service_role | Leaks counts; replace (DB-09) |
| `generate_tenant_invoice_number` | **none** | **no REVOKE (default PUBLIC)** | Replace (DB-10); revoke now |
| `search_medicines` | **none**; trusts `p_tenant_id`/`p_doctor_id` | authenticated | Derive tenant and doctor from `auth.uid()` or check membership |
| `get_tenant_table_rls_policies` | n/a | service_role only | OK |

---

## 7. Soft delete, audit, retention and erasure

**Facts**
- Soft delete exists only for `patients` (`is_deleted`, `status`, `erased_at`, `erasure_reason`, `000018:169-175`).
- `erasePatientRecord` sets those flags and writes an audit row (`features/dpdp/erasure.ts:59-110`). **Name, phone, DOB, address, ABHA, guardian data and every clinical record remain in place.** Phone numbers and template parameters (patient name, doctor, date/time) also persist in `communication_queue`. Webhook payloads persist in `webhook_delivery_queue.payload`. Storage objects are untouched.
- There is no purge or retention job for any table. `audit_logs`, `communication_queue`, `webhook_delivery_queue`, `api_key_usage_daily`, `in_app_notifications` and expired `document_share_tokens`/`invitations` grow without bound.
- Backups: `docs/operations/backups.md` and `docs/ops/backup-restore.md` exist and are owned by Workstream F. **Outstanding investigation:** the Supabase plan (PITR availability), restore drill evidence and region (data residency in India).

**Problems and recommendations**
- **P1 (DB-21):** Define a **data retention schedule**:
  - clinical records: at least 3 years under NMC, longer by state or clinic policy (**Assumption (validate)** with Workstream D and a legal reviewer)
  - messaging queue: 90 days, then null out `recipient_phone`/`template_params`
  - webhook payloads: 30 days
  - usage counters: 13 months
  - expired tokens: 30 days after expiry

> Verification (2026-11-10): PARTIALLY_CONFIRMED — DB-21/DB-22: confirmed; retaining clinical records is deliberate (statutory), the gap is identifier minimisation and post-retention purge. H/P1. See VERIFICATION_LOG.md

  Implement it as scheduled SQL functions run by the job scheduler (ADR-018).
- **P1 (DB-22):** Make erasure a two-stage process:
  1. Immediate *restriction*: hide the record, stop communications, revoke share tokens.
  2. Scheduled *anonymisation* after the statutory retention period: replace direct identifiers, delete storage objects, purge queue rows.

  Record each stage in an `erasure_requests` table with state.
- **P2 (DB-23):** Make the audit log tamper-evident: no UPDATE or DELETE grants even for `service_role` via trigger, an optional `prev_hash` chain, and partitioning by month once volume justifies it.

---

## 8. Migration practice

**Facts**
- 18 sequential files named `0000NN_name.sql`, rather than the Supabase CLI default timestamp prefixes.
- **Migrations were edited after creation:**
  - `000007` was changed by commit `1e43cc6` ("drop legacy prescriptions table in migration 000007")
  - `000014` was changed by commit `45521b5` ("update foreign key in migration 000014")

  Any environment that had already applied the original version has a different schema from a fresh build.
- `000004` creates `consultations` and a first `prescriptions` table that are dead or dropped later. `000007:56-57` `DROP TABLE … CASCADE` would destroy data if it ever ran against a populated table.
- `000017` contains conditional updates for tables that do not exist (`staff_members`, `clinics`, `000017:60-84`), which shows uncertainty about the actual schema.
- Rollback notes appear in only two files (`000016:15-18`, `000017:107-110`).
- There is no `supabase/seed.sql`. Reference data (`supabase/seed-data/cdci`, `terminology`) is loaded by `scripts/seed-*.ts` using the **service-role key from `.env`** against whatever project `.env` points at (`scripts/seed-cdci.ts:5-20`).
- There is no CI job that applies migrations from scratch and no local or ephemeral DB in the test setup (coordinator fact).
- `lib/db/types.ts` is hand-written and stale (about 10 tables missing; §2 of `ARCHITECTURE_ASSESSMENT.md`).

**Recommendations**
- **P1, S:** Freeze the rule that **applied migrations are immutable**; fixes are new migrations. Enforce it in CI by diffing `supabase/migrations/*` against `main` and blocking modifications to existing files.
- **P1, M:** Establish a **baseline**:
  1. Read-only `supabase db diff` / `pg_dump --schema-only` of production versus a fresh local build from the repo (an outstanding investigation, run by the owner).
  2. Write a reconciling migration if drift exists.
  3. Optionally squash 000001–000018 into a v2 baseline for new environments, while keeping history for existing ones.
- **P1, S:** Run `supabase start` plus `supabase db reset` in CI, followed by pgTAP RLS and constraint tests and `supabase gen types` diff checks.
- **P2, S:** Move reference-data loading to idempotent `seed.sql` or a migration-safe COPY script that targets the local stack by default and needs an explicit flag for remote.
- **P2, S:** Write every migration as an expand/contract pair: add NOT VALID → backfill → validate → switch code → drop.

---

## 9. Schema changes that affect existing data

Each change requires a read-only diagnostic first. The queries are in `BACKEND_MIGRATION_PLAN.md §3`.

| Change | Existing-data impact | Mitigation |
|---|---|---|
| Composite tenant FKs (DB-01) | Fails if any cross-tenant reference exists | `NOT VALID`, diagnose, investigate each row (possible abuse), then `VALIDATE` |
| Exclusion constraint (DB-08) | Fails if overlapping non-overbooked appointments exist | Diagnose; mark historical overlaps `is_overbooked = true` with an audit note, or constrain only `scheduled_at >= cutover` |
| Invoice FY numbering (DB-10) | None to existing numbers | New series starts at cutover; old numbers retained and unique constraint unchanged |
| Queue token counter (DB-09) | Historical `queue_tokens.date` values were computed in UTC (`features/queue/actions.ts:26`) | Leave history; fix forward; document in release notes |
| CASCADE→RESTRICT (DB-03) | None (DDL only) | Changes failure mode for deletes; verify no app path relies on cascades |
| Immutability triggers (DB-13) | Existing signed records become read-only; amendment flow must use the new RPC | Release together with refactored amendment service |
| `prescription_items.tenant_id` (DB-06) | Backfill from parent | Single UPDATE in a migration; table is small |
| Status CHECKs and coherence (DB-15/16/17) | Rows may violate | `NOT VALID`, clean up, then validate |
| Drop `consultations` and redundant indexes | Data loss only if `consultations` has rows | Check row count; archive first |
| Erasure anonymisation job (DB-22) | **Irreversible** | Dry-run report, owner sign-off, backup verified, feature flag |

---

## 10. Types generation

**Fact:** The types are hand-written. **Recommendation (P1, S):** Generate them (`supabase gen types typescript --local` today; `kysely-codegen` once Kysely is adopted, ADR-003). Commit the output to `lib/db/generated/`. Fail CI on diff. Domain DTO types should be derived from zod schemas, not from table types.

---

## 11. Findings register (database)

| ID | Summary | Priority | Size |
|---|---|---|---|
| RLS-01 | Self role escalation via memberships UPDATE | **P0** | S |
| DB-01 | Cross-tenant FK references possible | P1 | M |
| DB-03 | Cascades can wipe clinical and financial history; visit DELETE allowed | P1 | S |
| DB-05 | Polymorphic share-token resource without FK | P1 | S |
| DB-08 | No double-booking constraint | P1 | M |
| DB-09 | Queue token race and UTC date | P1 | S |
| DB-10 | Invoice numbering race, calendar year, timestamp fallback | P1 | S |
| DB-11 | No money CHECKs; overpayment and cancelled-invoice payment allowed | P1 | S |
| DB-13 | Signed records mutable | P1 | M |
| DB-20 | Invitation role and recipient checks | P1 | S |
| DB-21/22 | No retention; erasure is flag-only | P1 | M |
| RLS-02/03/06 | Tenant-only RLS; FOR ALL deletes; referral target update | P1 | M |
| SEC-DEF | SECURITY DEFINER functions trust `p_tenant_id`; missing REVOKE | P1 | S |
| MIG | Edited migrations; no CI rebuild; hand-written types | P1 | M |
| DB-02/04/06/12/14-19 | Clinician FK, redundant patient FK, item tenant, invoice uniqueness, CHECKs, `updated_at` triggers | P2 | M |
| IDX | Trigram search, missing FK indexes, redundant indexes | P2 | S |
| RLS-04/05/07/08/10/11 | Notifications scoping, audit forgery, erased visibility, policy performance, storage policy, RLS tests | P2 | M |
| DB-23 | Tamper-evident audit | P2 | S |
| DB-07/18 | CDCI FKs, phone CHECK | P3 | S |

> Verification (2026-11-10): PARTIALLY_CONFIRMED — SEC-DEF: metadata-only leak; anon EXECUTE probably wider than claimed (OI-5). M/P2. See VERIFICATION_LOG.md
