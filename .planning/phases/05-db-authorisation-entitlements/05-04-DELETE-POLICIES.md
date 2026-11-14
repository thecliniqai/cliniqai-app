---
phase: 05
plan: 05-04
subsystem: database authorisation (DELETE policies, RESTRICT proof, silent no-op fixes)
status: complete
requirements: [P1-08, BACKEND C4, research Pitfall 11, R-21, R-22]
plan_head_before: 179dd105b95756f4c7c9f19a38e3593ccb9d999c
plan_head_after: 7b884a9
commits: [f5f8450, 7b884a9]
---

# 05-04 record: RESTRICT proof, every DELETE policy, silent no-op fixes

**Outcome:** done locally. Migration `000052_delete_policies.sql` sets every table DELETE policy to its final rule
from the 05-PLAN target matrix, bound to the **active** clinic through the `authz` helpers: no member deletes a visit,
prescription, queue token, waitlist entry, patient, invoice or payment any more (`visits_delete_member` and the other
parent DELETE policies are gone); the three deletes that were silent no-ops (doctor: draft Rx item, diagnosis;
anyone: invoice item) now work for the role that performs them. The services ask for the deleted rows and turn
"0 rows" into FORBIDDEN with no audit row, instead of reporting success. The RESTRICT actions 05-03 set are proven
(as `postgres`), and deleting a tenant still cascades every row of the clinic to 0. Nothing hosted was contacted;
every Supabase CLI call used `--local`; resets ran under the test-run lock.

## What shipped

| Commit | Content |
|---|---|
| `f5f8450` | `000052_delete_policies.sql`; `EXPECTED_MIGRATION = "000052"`; schema snapshot; matrix (`tests/authz/table-matrix.ts`: final DELETE rules, rule kind `full`, `restrictDelete` removed), generator (`full`, outcome `R` removed, `ruleText` exported), regenerated `authz_matrix.test.sql` + `AUTHZ-MATRIX.md`; `tests/authz/table-matrix.spec.ts` "the DELETE column (final since 05-04)"; `lib/db/errors.ts` `unaffectedRowsError` (FORBIDDEN, reason `ROW_NOT_AFFECTED`); the seven delete paths use `.select("id")` and refuse a no-op before any audit row or follow-on write; `deleteLabDocument` guard `labs:edit` (action, service, guard-manifest row); guard leg 3b dual client acting in A; two specs adapted to the row-first lab delete |
| `7b884a9` | `supabase/tests/database/delete_rules.test.sql` (35), `tests/integration/delete-paths.spec.ts` (8, real JWTs) |
| docs | this record, wave notes, evidence |

`types/database.ts` is unchanged (policy-only migration; `npm run db:types` produced no diff).

### DELETE rules after 000052 (table targets; storage stays with 05-02c)

| DELETE rule | Tables |
|---|---|
| none (privilege held, no policy: 0 rows) | tenants, patients, **visits**, visit_revisions, consultations, **prescriptions**, invoices, payments, **queue_tokens**, **waitlist_entries**, consent_records, **referrals**, **tenant_messaging_config**, audit_logs, subscriptions, payment_records, cdci_* / opd_diagnoses |
| privilege revoked (`rpc_only`) | memberships, invitations, document_share_tokens, communication_queue, webhook_delivery_queue, ops.* |
| `consultations:edit` | consultation_diagnoses, follow_ups |
| `prescriptions:edit` | prescription_items (its own `tenant_id`, 05-03) |
| `billing:collect` | invoice_items |
| `labs:edit` | patient_documents |
| `consultations:edit` and own `doctor_id` | doctor_custom_diagnoses, doctor_custom_medicines, doctor_prescription_templates |
| own `doctor_id` with `appointments:edit`, or `clinic:manage` | schedule_blocks (same rule as the service) |
| own row (`recipient_user_id`) in the active clinic | in_app_notifications |
| `clinic:manage` | api_keys, api_key_usage_daily, webhook_subscriptions |

Bold = lost a member DELETE in this plan. The 8 `FOR ALL` policies were split: their SELECT/INSERT/UPDATE keep the
legacy predicate verbatim (05-02b/05-02c replace them by name), DELETE is a separate policy (or none).

### Delete paths (services)

| Path | Before | After |
|---|---|---|
| `removePrescriptionItem` | DB owner/admin only: a doctor got success + audit row, item kept | doctor deletes; 0 rows → FORBIDDEN, no audit |
| `removeConsultationDiagnosis` | same; the chronic-condition cleanup also ran | doctor deletes; 0 rows → FORBIDDEN before touching the patient |
| `deleteInvoiceItem` | no DELETE policy: success, totals recomputed, audit row, item kept | `billing:collect` deletes; 0 rows → FORBIDDEN before totals/audit |
| `saveConsultationDraft` (no follow-up) | owner/admin only: follow-up silently kept | doctor clears it; fewer deleted than visible → error, no draft audit |
| `deleteLabDocument` | storage object deleted **before** the row (a refused row would leave a row pointing at nothing) | row first, 0 rows → FORBIDDEN with row and file kept; then the storage object |
| `deleteScheduleBlock` | error only | 0 rows → FORBIDDEN, no audit |
| `deleteWebhookSubscription` | an unknown or filtered id reported success + audit | "Webhook subscription not found.", no audit |

## Tests that fail without the change (tool output, `evidence/05a/05-04/`)

- `delete_rules.test.sql` (35): RESTRICT proof as `postgres` (patient with visits / with only a consent record, visit
  with an invoice / with a prescription / with history, invoice with a payment, the membership of a doctor named on
  visits → `23503`; controls: childless patient and visit delete, invoice/prescription delete cascades their items);
  catalogue `set_eq`: every non-RESTRICT reference to patients/visits/invoices/prescriptions is one of the 2 planned
  CASCADE items + 4 `SET NULL (col)` links (P1-08); the DELETE policy set equals the 05-04 set exactly; no `FOR ALL`
  policy on a public table; every DELETE policy on `authz.tenant_ids_with`/`full_tenant_ids` and none on the legacy
  helpers; real principals (JWT claims + header): owner/admin cannot delete a childless visit, a prescription or a
  patient (0 rows), doctor deletes Rx item / diagnosis / follow-up, receptionist deletes an invoice item, nurse /
  receptionist / admin cannot delete an Rx item, doctor cannot delete an invoice item, the dual member deletes only
  while acting in A, clinic B's owner nothing; deleting the tenant leaves 0 rows of the clinic in every table with a
  tenant FK. **Without 000052: 12 of 35 fail** (`delete-rules-pgtap-without-05-04.txt`: the catalogue checks, owner/
  admin visit and prescription deletes = 1, doctor Rx item / diagnosis / follow-up and receptionist invoice item = 0).
- Regenerated `authz_matrix.test.sql` (2200 cells) against the stack without 000052: **87 DELETE cells fail**, no
  other cell (`authz-matrix-without-05-04.txt`).
- `delete-paths.spec.ts` (8, real JWTs through the services): **without 000052 and the service fix: 7 of 8 fail**
  (`delete-paths-without-05-04.txt`: success reported, row still present); **with 000052 but without the service fix:
  the 2 refusal cases fail** (`delete-paths-without-service-fix.txt`: a doctor's invoice item delete and a session
  bound to the other clinic report success for a row that is still there). The receptionist Rx item case passes in
  both (it is refused by the service guard; kept as the plan's control: FORBIDDEN, row kept, no audit row).
- `tests/authz/table-matrix.spec.ts` "the DELETE column": pins every table target's DELETE rule to the plan's
  column, no legacy kind, no deleter of visits/prescriptions/invoices/payments/patients, the three former no-ops.

## Decisions and deviations

1. **[Rule 2] All seven member delete paths are row-checked**, not only the four files the plan lists (labs,
   schedule blocks, webhooks also delete under RLS). Update paths are not swept here (05-02b rewrites S/I/U; wave note).
2. **[Rule 1] `deleteLabDocument` deleted the storage object before the row**: with the new `labs:edit` DELETE rule a
   receptionist's refused delete would have destroyed the file and kept the row. The row is now deleted first.
3. **`FOR ALL` policies split** (8 tables) so DELETE has its own policy; S/I/U predicates copied verbatim from the
   catalogue (snapshot diff shows only the split).
4. **New matrix rule kind `full`** (active clinic, any role) for the notifications DELETE (`all(self(recipient_user_id),
   full)`), mirroring `authz.full_tenant_ids()`; the plan allowed adding row-extra kinds when first needed.
5. **Storage DELETE not touched**: 05-02c's `storage_policies` replaces every `storage.objects` policy of the two
   buckets per class (contract table DELETE column: lab `labs:edit`, referral letter none, branding `clinic:manage`).
6. **[Rule 3] `deleteLabDocument` guard `patients:edit` → `labs:edit`** (action, service, guard-manifest row): the
   guard suite's leg-3 positive control (least-privileged holder of the guard key = receptionist) failed against the
   `labs:edit` DELETE rule. Other guards stay (05-02b owns the guard call sites): `deleteInvoiceItem` admits
   doctors/nurses (`appointments:edit`) whom the DELETE rule refuses: they now get FORBIDDEN instead of a silent
   success. Product effect, per the plan's target matrix: receptionists and admins can no longer delete lab reports
   (receptionists never had the button; admins still see it, wave note); doctors and nurses cannot delete invoice
   items (PO-3).
8. **[Rule 1, test] Guard leg 3b ran the dual member without the active-clinic header** (the mocked slot client
   bypasses `createClient()`'s carrier, as the 05-01b wave note warned): with bound DELETE rules the positive controls
   of 7 delete actions failed (the invoice-item and Rx-item ones had "passed" before only as silent no-ops). The leg
   now uses `signInActingIn(email, tenantA)`; B's snapshot check is unchanged and green.
9. Two specs adapted to the row-first lab delete: `no-raw-error-logging.spec.ts` (a failed row delete no longer
   reaches the storage step) and `review2-fixes-db.spec.ts` AR2-L5 (the fake client now returns the deleted row).
7. The 0-row error is `DEFAULT_APP_ERROR_MESSAGES.FORBIDDEN` (same text as the guard refusal); the follow-up clear
   returns a fixed "Draft saved, but the follow-up could not be cleared" because the draft write precedes it.

## Lanes (final, tool output in `evidence/05a/05-04/`)

Run on the tree of `7b884a9` (both commits; only this record, wave notes and evidence were added after):
- `npm run typecheck` clean; `npx eslint .` 0 errors (382 warnings, pre-existing kinds); `npm run inventory` exit 0;
  `npm run authz:gen -- --check` clean; `npm run db:drift:local` PASS (`static-checks.txt`).
- pgTAP lane: 8 files, **2451 tests, PASS** (2416 + 35); report gate PASS (`pgtap-lane.txt`).
- Full Vitest: **4476 tests, 4476 passed, 0 failed**, 221 files (`vitest-full.txt`). The first full run (before the
  leg-3b, lab-guard and two spec adaptations above) had 10 failures, all explained in deviations 6, 8 and 9.
- E2E PR lane (desktop-chrome, Pixel 7, iPhone 15): **196 passed, 9 skipped** (pre-existing project-scoped skips),
  **0 retried / 0 flaky** (`e2e-pr.txt`). The web server log shows 6 `ECONNRESET aborted` and 4 `/patients`
  `request.error` lines with every test green; not investigated in this plan (flag for the gate reviewer if they are
  new relative to 05-03).
- `types/database.ts`: `npm run db:types` produced no change.

## Self-Check

PASSED. Files present: migration, `delete_rules.test.sql`, `delete-paths.spec.ts`, 8 evidence files; commits
`f5f8450`, `7b884a9` are ancestors of HEAD; the local stack is at 000052 (`db reset --local` after the before-runs).
