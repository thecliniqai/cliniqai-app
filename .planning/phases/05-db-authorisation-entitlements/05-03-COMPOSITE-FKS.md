---
phase: 05
plan: 05-03
subsystem: database integrity (composite tenant FKs, prescription_items.tenant_id, diagnostics)
status: complete
requirements: [P1-02, BACKEND C1-C3, DB-01, DB-02, V2-02 OA-4 (structural fix), V2-03 triage M-XTENANT-WH]
plan_head_before: 3063d288e2f465c52e13984d255fe54e7a26fa4d
commits: [d861c69, 33b6848, a44a2a0]
---

# 05-03 record: composite tenant FKs, `prescription_items.tenant_id`, diagnostics

**Outcome:** done locally. A child row can now reference a parent (patient, visit, invoice, prescription, lab
document, API key, webhook subscription) only in its **own** clinic, and a doctor reference only a **member** of its
clinic: 38 composite foreign keys, created NOT VALID with their final delete action, validated after the diagnostics
showed 0 violations, the 28 replaced single-column FKs dropped. `prescription_items` has its own `tenant_id`
(backfilled, NOT NULL, filled by trigger, composite FK). A loopback-only diagnostics tool (`npm run db:diagnostics`)
runs BACKEND §3 D0-D10 plus D1/D5 for every covered pair and writes counts only. Acceptance 3 ("a cross-tenant child
insert fails") holds for every covered FK, through PostgREST with a member's JWT and as `postgres`. Nothing hosted was
contacted; every Supabase CLI call used `--local`; resets ran under the test-run lock.

## What shipped

| Commit | Content |
|---|---|
| `d861c69` | `scripts/db/diagnostics.{sql,mjs}`, `npm run db:diagnostics`, `tests/ci/diagnostics-script.spec.ts` |
| `33b6848` | migrations `000047_tenant_parent_keys`, `000048_prescription_items_tenant_id`, `000049_composite_fks_expand`, `000050_composite_fks_validate`, `000051_composite_fks_contract`; `EXPECTED_MIGRATION = "000051"`; schema snapshot; `types/database.ts`; `features/billing/reports-service.ts` (embed hints); diagnostics V0 volume check; matrix (`prescription_items.tenant_id` fixture, `restrictDelete` outcome `R` for `visits`) + regenerated `authz_matrix.test.sql` / `AUTHZ-MATRIX.md`; `tests/helpers/sql.ts` `plantLegacyRow`; existing specs adapted (below) |
| `a44a2a0` | `supabase/tests/database/composite_fks.test.sql` (101), `supabase/tests/database/migration_edge_cases_fk.test.sql` (21), `tests/ci/fk-edge-cases-inline.spec.ts`, new case in `tests/security/cross-tenant-refs.spec.ts` |
| docs | this record, wave notes, evidence |

### The 38 composite FKs (000049; names `<child>_tenant_<ref>_fkey`)

- **RESTRICT (18):** visits→patients; invoices→patients, →visits; payments→invoices; prescriptions→patients, →visits;
  consultation_diagnoses→patients, →visits; consultations→patients; consent_records→patients; follow_ups→patients;
  patient_documents→patients; communication_queue→patients; queue_tokens→visits; visit_revisions→visits;
  waitlist_entries→patients, →visits (`promoted_visit_id`); referrals→patients.
- **CASCADE (5):** invoice_items→invoices; prescription_items→prescriptions; document_share_tokens→patient_documents;
  api_key_usage_daily→api_keys; webhook_delivery_queue→webhook_subscriptions (**M-XTENANT-WH structural fix**).
- **`SET NULL (<col>)` (5):** follow_ups.visit_id, patient_documents.visit_id, communication_queue.appointment_id,
  referrals.visit_id, audit_logs.api_key_id (column list: a plain SET NULL would null `tenant_id`, Pitfall 3).
- **Doctor → `memberships (user_id, tenant_id)`, RESTRICT (10):** `doctor_id` of visits, prescriptions, consultations,
  follow_ups, waitlist_entries, schedule_blocks, doctor_custom_diagnoses, doctor_custom_medicines,
  doctor_prescription_templates; referrals.referring_doctor_id.
- Unchanged: every `tenant_id → tenants` CASCADE, every FK to `auth.users`, `referrals.target_tenant_id` /
  `target_doctor_id` (cross-tenant by design). 18 new `(tenant_id, <fk>)` indexes where none led with those columns.
- **OA-4 coverage (V2-02 02-PLAN ~l.492):** visits (patient, doctor), waitlist (patient, promoted visit, doctor),
  consent_records, follow_ups (patient, visit, doctor), consultation_diagnoses (patient, visit), referrals (patient,
  visit, referring doctor), invoices (patient, visit), schedule_blocks (doctor), patient_documents.visit_id: all
  covered. `lib/auth/tenant-refs.ts` stays (friendly errors, and same-clinic mismatches such as "B patient on an A
  visit" that a two-column FK cannot express).

## Diagnostics (tool output, `evidence/05a/diagnostics/`, counts only)

Sequence on ONE data-carrying local database (no reset in between): `npm run e2e:pr` and a full Vitest run with
`TEST_KEEP_DATA=1` at schema 000046, then `npm run seed:local` → **`before-05-03.json`** (173 tenants, 1556 visits,
689 prescription items, …); 000047-000049 applied with `psql -1` on top (`evidence/05a/05-03/replay-on-seeded-data.txt`:
backfill 689/689 rows, 0 null, 0 mismatched) → **`after-expand-with-test-fixtures-05-03.json`**; 000050 attempted →
**refused** (`visits_tenant_patient_fkey`, psql exit 3, rolled back: the safety net works on real data); the
attributed fixture rows removed (counts in the replay file) → **`after-expand-05-03.json`** (D1, D1x, D5, D5x all 0)
→ 000050 and 000051 applied → **`after-contract-05-03.json`**; `select count(*) from pg_constraint where contype='f'
and not convalidated` = **0** (whole database), 38 composite FKs, 0 single-column FKs left to tenant parents. The
canonical stack was then rebuilt with `db reset --local`.

**Non-zero D1/D2/D4/D5x before (plan step 1 says "stop and raise"): investigated, all are deliberate fixtures of
negative tests in the local run data, none is an incident.** Attribution (tenant names of the rows):

| Check | Rows | Planted by |
|---|---|---|
| D1 / D1x visits→patients | 1 | this plan's own new case in `cross-tenant-refs.spec.ts`, run before the change (it proves the gap) |
| D1 / D1x patient_documents→patients | 1 | `tests/jobs/enqueue-webhook-rpc-db.spec.ts` (lab_result.ready refusal for another clinic's patient) |
| D1x follow_ups.visit_id | 1 | `tests/security/guard-canary.spec.ts` (d) (the deliberately defective leg-3 canary) |
| D1x document_share_tokens.document_id, D2 (3) | 1 + 3 | `tests/security/share-tokens.spec.ts` (forged cross-tenant tokens, TC-TOK-02/03) |
| D1x communication_queue.appointment_id | 1 | `tests/security/webhook-lockdown.spec.ts` (TC-WH-05/07 forged reply pointer) |
| D1x webhook_delivery_queue.subscription_id | 3 | `tests/api/webhook-dispatch-hardening.spec.ts`, `tests/jobs/webhook-deliver-handler-db.spec.ts` (M-XTENANT-WH) |
| D5x schedule_blocks.doctor_id | 12 | `tests/security/guard/world.ts` (outsider caller's own block in clinic A) |
| D4b (multi-owner clinics) | 3 | guard worlds (`Synthetic Guard Clinic A`, `Guard Canary3 A`, `Guard Routes A`): test clinics, no FK involved |

D2 (share-token resource, polymorphic `resource_id`, no FK) and D4b remain non-zero in the after files for the same
fixtures; neither is a VALIDATE precondition. D3, D5, D6-D10 are 0 throughout.

## Tests that fail without the change (tool output, `evidence/05a/05-03/`)

- `composite_fks.test.sql` (101): expected FK set (`set_eq`, 38 rows with columns, parent and delete action); none
  NOT VALID; the 28 old FKs gone; **37 cross-tenant negative cells** (clone of a tenant-A child row with one reference
  pointed at tenant B's parent or a B-only member → `23503`), 38 same-tenant controls (`ok`); M-XTENANT-WH as
  `postgres`; UPDATE re-pointing; `prescription_items` (23514 on a mismatched supplied tenant, 23503 on re-pointing,
  fill on insert, NOT NULL, consistency, FK to tenants); SET NULL (`visit_id`, `appointment_id`, `api_key_id`) keeps
  `tenant_id`; patient with visits not deletable; **deleting the tenant cascades through the RESTRICT children**.
  Without 000047-000051 (stack reset at 000046): set_eq and drop checks fail and all 37 negatives return `ok`
  (`pgtap-without-05-03.txt`).
- `migration_edge_cases_fk.test.sql` (21, rolled back): D1 cross-tenant visit, D5 non-member doctor, M-XTENANT-WH
  delivery: drop FK, plant, verbatim D1/D5 finds the row, re-add NOT VALID lives, VALIDATE `23503`, correct, D = 0,
  VALIDATE lives; 000048 backfill replayed verbatim (pinned by `tests/ci/fk-edge-cases-inline.spec.ts`). Without the
  change the file cannot find `visits_tenant_patient_fkey`.
- `cross-tenant-refs.spec.ts` new case: direct PostgREST insert with a receptionist's JWT of an A visit naming B's
  patient, and one naming a B-only doctor → `23503`; same-clinic control inserts. Before: `error` undefined, row
  created, and the spec's "no tenant A row references a tenant B id" also failed (`cross-tenant-refs-without-05-03.txt`).
- `diagnostics-script.spec.ts` (15): non-loopback `--db-url` (host or port), `--linked`, `--project-ref`, bare
  connection string, unknown flag, bad label, remote `DOCKER_HOST` → exit 1 with no docker call and nothing written;
  parser keeps counts only; a planted cross-tenant visit and non-member doctor raise D1, D1x, D5, D5x by exactly 1.

## Decisions and deviations

1. **[Rule 1] Embed hints by column name stop resolving** for a composite FK (PGRST200 "Could not find a relationship
   between 'payments' and 'invoice_id'", probed on the stack): `features/billing/reports-service.ts` (daily collection
   report, the only column-name hint in `app/ features/ lib/ components/ tests/ scripts/`) now names the constraints
   (`invoices!payments_tenant_invoice_fkey`, `patients!invoices_tenant_patient_fkey`, `visits!invoices_tenant_visit_fkey`);
   caught by `tests/integration/receipt-reports.spec.ts`. No `!<constraint>` hint named a dropped FK (step 1 grep).
2. **[Rule 3] Existing specs that planted cross-tenant rows** to prove a downstream check (8 specs, the table above)
   could no longer write them. Each now asserts the new 23503 for the normal writer (service role / JWT) **and** plants
   the pre-05-03 row with FK triggers off through `plantLegacyRow` (`tests/helpers/sql.ts`, superuser session,
   `session_replication_role = replica` for one transaction) so the handler / route / RPC check stays proven as defence
   in depth. The guard world's outsider block uses the clinic's doctor. The canary (d) now shows one-at-a-time forging
   reaching the write (`"Failed."`, DB refusal) and the detector catching a planted stored reference.
3. **[Rule 3] `prescription_items` Insert type requires `tenant_id`** (generated types: NOT NULL, no default). App
   inserts use untyped clients and rely on the trigger (unchanged); five typed test inserts now pass `tenant_id`.
4. **Matrix outcome `R` (`error:23503`)**: the legacy owner/admin DELETE policy on `visits` admits the delete, the
   RESTRICT children refuse it; `restrictDelete` on the visits target encodes it until 05-04 drops `visits_delete_member`.
5. **Fill trigger is SECURITY INVOKER** (the plan names no definer): a caller who cannot see the parent gets NOT NULL
   (23502); the composite FK checks the real parent regardless of RLS.
6. **Diagnostics additions** beyond §3 verbatim: D1x/D5x (every pair this plan covers; §3 says "repeat for each pair"),
   V0 row volume, FKNV. `--db-url` is accepted only as a loopback assertion (the tool always reads the local
   container); the plan's `evidence/<part>/diagnostics/` is `evidence/05a/diagnostics/`.
7. **Replay with `psql -1` on the kept data** (not `db reset`) so validate ran on ~1.5k visits of real flow data;
   `supabase migration up` is not in the protocol's allowed list, so the files were fed to the local container's psql.
8. Baselines at `3063d28` + the untracked migration files: full Vitest 3 failed (readiness `EXPECTED_MIGRATION`, two
   hosted-dump drift cases: both caused by the not-yet-applied 000047-000051 files in the tree, no other failure);
   e2e PR lane 196 passed, 9 skipped, 0 retried.

## Lanes (final, tool output in `evidence/05a/05-03/`)

Run on the tree of `a44a2a0` (all three commits; only this record and evidence were added after):
- `npm run typecheck` clean; `npx eslint .` 0 errors; `npm run inventory` 0 flagged; `npm run authz:gen -- --check`
  clean; `npm run db:drift:local` PASS (`db-drift-local.txt`); `scripts/ci/lock-linux-check.sh` PASS (scripts-only
  `package.json` change).
- pgTAP lane: 7 files, **2416 tests, PASS**; report gate PASS (`pgtap-lane.txt`).
- Full Vitest: **4463 tests, 4463 passed, 0 failed**, 220 files (`vitest-full.txt`).
- E2E PR lane (desktop-chrome, Pixel 7, iPhone 15): **196 passed, 9 skipped** (pre-existing project-scoped skips),
  **0 retried / 0 flaky** (`e2e-pr.txt`).

## Self-Check

PASSED. Files present (5 migrations, `scripts/db/diagnostics.{sql,mjs}`, both pgTAP files, both new specs, 4
diagnostics reports, 7 evidence files); commits `d861c69`, `33b6848`, `a44a2a0` are ancestors of HEAD
(`git merge-base --is-ancestor`); `select count(*) from pg_constraint where contype='f' and not convalidated` = 0 on
the reset stack.
