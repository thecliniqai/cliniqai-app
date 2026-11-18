---
phase: 05
plan: 05-02b
subsystem: database authorisation (clinical, front-desk and financial policies; guard call sites)
status: complete
requirements: [P1-01, P0-14 (RLS part), PO-3, SVP §6.1, R-6, R-7, R-8, R-9, R-42]
plan_head_before: 2ede10f
plan_head_after: 01e9a93
commits: [63412af, c5735c7, 01e9a93]
---

# 05-02b record: clinical, front-desk and financial policies + guard call sites

**Outcome:** done locally. Migrations `000054_policies_clinical`, `000055_policies_front_desk` and
`000056_policies_financial` put the SELECT/INSERT/UPDATE policies of 20 tables on their target rule from the 05-PLAN
"Target policy matrix", every one bound to the caller's **active** clinic through the `authz` helpers (R-42; before:
any membership in any of the caller's clinics, whatever the role). PO-3 is enforced in the database and in the
services: receptionists register patients and collect; doctors and nurses no longer collect; a doctor reads and bills
only the visits they are the doctor of (Sign & Bill routes the fee to reception unless they also hold
`billing:collect`, the owner of a solo clinic); receptionists and admins no longer read diagnoses, prescriptions or
referrals; a front-desk or admin change of allergies/chronic conditions is refused (R-8). The Sign & Bill modal offers
"collect at the desk" only to a `billing:collect` holder. Nothing hosted was contacted; every Supabase CLI call used
`--local`; resets ran under the test-run lock.

## What shipped

| Commit | Content |
|---|---|
| `63412af` (feat) | migrations 000054-000056; `EXPECTED_MIGRATION = "000056"`; schema snapshot; matrix (`tests/authz/table-matrix.ts`: 20 tables on target S/I/U rules, new row extra `ownVisit`), generator (`ownVisit`), regenerated `authz_matrix.test.sql` (2244 cells) + `AUTHZ-MATRIX.md`; billing guards → `billing:collect` (actions + service), Sign & Bill (own visit, collect refused up front), modal + workspace + consultation page (`canCollect`); guard call sites aligned with the new RLS (below); `updatePatient` (R-8 check, 0-row refusal); guard manifest; existing specs adapted (below); M0 consult-rx-finish e2e |
| `c5735c7` (fix) | the v1 collect toggle gets an accessible name (`aria-label`): axe `label` (critical) on the owner's modal, found by the new screens spec on the first PR-lane run |
| `01e9a93` (test) | `supabase/tests/database/domain_policies.test.sql` (42), `tests/billing/collect-permission.spec.ts` (12), `tests/patients/receptionist-registration.spec.ts` (7), `tests/authz/table-matrix.spec.ts` (3 new cases), `tests/e2e/a11y/sign-and-bill-screens.spec.ts` (6) |
| docs | this record, wave notes, evidence |

`types/database.ts` is unchanged (the only new function is a trigger function; `npm run db:types` produced no diff).

### Policies after 000054-000056 (S / I / U; DELETE stays 05-04's)

| Table | SELECT | INSERT | UPDATE |
|---|---|---|---|
| consultation_diagnoses, consultations (dead, R-34) | consultations:view | consultations:edit | consultations:edit |
| visit_revisions | consultations:view | consultations:edit | — |
| prescriptions, prescription_items (own `tenant_id`, no subquery) | prescriptions:view | prescriptions:edit | prescriptions:edit |
| doctor_custom_diagnoses / _medicines, doctor_prescription_templates | consultations:view | consultations:edit AND own `doctor_id` | same |
| referrals (originating / target) | consultations:view of either clinic | consultations:edit | consultations:edit of either clinic (+ target guard) |
| patients | patients:view | patients:edit | patients:edit + `patients_clinical_fields_guard` |
| consent_records | patients:view | patients:edit | — |
| visits, queue_tokens, waitlist_entries | appointments:view | appointments:edit | appointments:edit |
| schedule_blocks | appointments:view | own `doctor_id` with appointments:edit, or clinic:manage | same |
| follow_ups | appointments:view | appointments:edit or consultations:edit | same |
| communication_queue | appointments:view | — (V2-04 revoke) | — |
| invoices | billing:view, or consultations:edit and own visit | billing:collect, or consultations:edit and own visit | same as INSERT |
| invoice_items | as invoices, own visit through the invoice | as invoices | as invoices |
| payments | as invoices (through the invoice) | billing:collect | — |

Plus: `public.patients_clinical_fields_guard()` (BEFORE UPDATE, invoker, `search_path=''`, EXECUTE revoked from
API roles): a signed-in caller without consultations:view in the row's clinic may not change `allergies` or
`chronic_conditions` (42501 `PATIENT_CLINICAL_FIELDS`); INSERT unrestricted (intake). `generate_tenant_invoice_number`
(definer, same body otherwise): service role, or `has_permission(t, 'billing:collect')` or
`has_permission(t, 'consultations:edit')` (R-7). `referrals_target_update_guard`: the originating-clinic exemption is
`has_permission(OLD.tenant_id, 'consultations:edit')` (bound to the active clinic) instead of "any membership there".

### Guard call sites

| Entry point | Before | After | Why |
|---|---|---|---|
| billing `createVisitInvoice`, `recordPayment`, `addInvoiceItem`, `deleteInvoiceItem` (action + service) | appointments:edit | billing:collect | PO-3 (plan) |
| billing service `createVisitInvoice` (Sign & Bill callee) | appointments:edit | billing:collect, or consultations:edit and the visit's own doctor | R-7 (plan) |
| `completeAndBillConsultation` | sign consultations:edit; payment appointments:edit | + `payment_collected` needs billing:collect, refused before anything is signed | PO-3 (plan) |
| `sendConsolidatedConsultationWhatsApp` (action + service) | consultations:view | prescriptions:view | [Rule 3] leg-3 control (nurse) could not read the Rx/invoice it links |
| prescriptions `getPrescriptionPdfSignedUrl`, `sharePrescriptionViaWhatsApp`; route `/api/visits/[id]/prescription-pdf` | consultations:view | prescriptions:view | [Rule 3] same (nurse lacks prescriptions:view) |
| referrals `createReferral`, `acknowledgeReferral`, `closeReferralLoop` | patients:edit | consultations:edit | [Rule 3] leg-3 control (receptionist) refused by the clinical RLS |
| referrals `getReferralSignedUrl`, `shareReferralLetterViaWhatsApp` | patients:view | consultations:view | [Rule 3] same |
| referrals register lists, `getPatientReferrals`, `getVisitPrescription` | unchanged | unchanged | a lacking role gets an empty list / null (pages must not throw) |
| `updatePatient` (service) | patients:edit | + R-8: allergy/condition change needs consultations:view (fixed text); unchanged values are not sent; 0 rows → FORBIDDEN | R-8 (plan); 05-04 wave note (row-checked updates) |

## Tests that fail without the change (tool output, `evidence/05a/05-02b/`)

- Regenerated `authz_matrix.test.sql` (2244 cells) on a stack without 000054-000056: **221 cells fail**, and
  `domain_policies.test.sql` aborts after 5 (guard absent) — `pgtap-without-05-02b.tap`.
- `collect-permission.spec.ts` + `receptionist-registration.spec.ts` (19, real JWTs through the services):
  **without 000054-000056: 7 fail** (`specs-without-05-02b-migrations.txt`: a doctor's direct `record_payment` and a
  nurse's direct payments insert succeed, a doctor reads a colleague's invoice and a nurse every invoice, a dual
  member acting in the other clinic reads/collects/edits, the database accepts a receptionist's allergy change);
  **with the migrations but the pre-change services: 4 fail** (`specs-without-service-change.txt`: a nurse's
  collection is refused only by RLS with a different text, a doctor's collecting Sign & Bill signs the visit before
  the payment is refused, a doctor's invoice for a colleague's visit, a receptionist's allergy change gets no fixed
  text). Receptionist registration itself (acceptance 5) passes in both: the permission came in 05-01b, the
  binding and R-8 here.
- `domain_policies.test.sql` (42): exact S/I/U policy set of the 20 tables, none on a legacy helper, all
  `TO authenticated`, no `FOR ALL`; the guard (receptionist/admin 42501, demographics ok, same values ok, intake ok,
  nurse/doctor/owner ok, system path ok, dual member acting elsewhere 0 rows / 42501); invoice numbering (receptionist,
  admin, doctor ok; nurse, B's owner, dual-in-B, anon refused); referral target guard (a doctor of both clinics
  acting as the target cannot rewrite it — before: exempted by the A membership); doctor sees one of two invoices and
  payments, nurse none, receptionist both.
- `table-matrix.spec.ts`: the 20 tables' S/I/U rules pinned, the plan's example cells, no "dual member acting in B"
  cell admitted on them.
- E2E `sign-and-bill-screens.spec.ts` (doctor/owner × 360/820/1280): doctor has no toggle and routes to reception;
  owner keeps the toggle; no serious/critical axe rule outside the M0 baseline of `/consultation/[id]`.

## Decisions and deviations

1. **[Rule 3] Guard call sites beyond billing** (table above): the guard suite's leg-3 positive control runs as the
   least-privileged holder of each guard key; with the target RLS a nurse cannot read a prescription and a
   receptionist cannot read or write a referral, so those guards moved to the RLS key of the rows they act on.
   Reads that only list stay where they were, so a lacking role sees an empty list instead of an error page.
2. **[Rule 2] `referrals_target_update_guard` bound to the active clinic** (see above, `domain_policies` case).
3. **[Rule 1] `updatePatient`**: always sent `allergies`/`chronic_conditions` (`[]` when omitted) and used
   `.single()` (a filtered update read as a generic failure). Now: changed clinical fields without
   consultations:view → fixed text before the write; unchanged ones are not sent; 42501 → the same text; 0 rows →
   FORBIDDEN (`unaffectedRowsError`).
4. **`patient_documents` S/I/U left on the legacy rule.** It is in neither 05-02b's nor 05-02c's table list (its
   DELETE is 05-04's `labs:edit`). Moving it to `labs:view`/`labs:edit` needs the lab guards (`patients:*` today) and
   the lab UI aligned at the same time; 05-02c owns the lab storage class, lab keys and `features/labs/service.ts`,
   so it is handed there with the admin delete-button issue (wave note).
5. **Matrix row extra `ownVisit`** (`via: visit_id | invoice_id`), as the matrix doc foresaw; the generator resolves
   the visit's doctor from the fixtures.
6. **Existing specs adapted** (each failed for the intended reason): multi-clinic specs (`cross-tenant`,
   `multi-clinic-tenant-filters`, `visit-history`, `clinic-visits-register`, `record-payment-rpc` dual leg, guard
   "not vacuous" leg) act through clients that name the clinic (`signInActingIn`), as `createClient()` does (K-15);
   `multi-clinic-tenant-filters` now proves the database refuses C's visit acting in A (its old "precondition" read is
   closed); guard world rows point at the calling doctor (R-7) and the Sign & Bill valid input routes to reception;
   H-PAY payment cases act as the front desk (the nurse no longer collects); `record_payment` per-role case follows
   `billing:collect` (the function's own appointments:edit list is 05-02c's); AR3-N2 Sign & Bill runs as the
   solo-clinic owner; `pdf-route-guards` nurse → 403; `delete-paths` dual leg refused at the first read;
   `consultation-service-guards` doctor routes to reception; `clinic-visits-register` doctor sees revenue of own
   visits only (0 there); M0 `consult-rx-finish` asserts the toggle is absent for the doctor.
7. **`record_payment` and the enqueue RPCs** are not touched (plan: 05-02c replaces the role check); the payments
   INSERT policy already binds `record_payment` (invoker): a doctor's direct call fails 42501, a nurse's NOT_FOUND.

## Product effects to note for the gate (all from the plan's target matrix / PO-3)

- Doctors: no collection; Sign & Bill shows "Payment at reception"; the visits register and patient history show
  invoices of their own visits only. The receipt WhatsApp button in the Sign & Bill success card stays refused for
  doctors (`billing:view`, unchanged since V2-03; not this plan).
- Nurses: no invoices, no prescriptions; the queue card still shows "Checkout" (refused by the server) — V2-08.
- Receptionists/admins: no diagnoses, prescriptions or referrals (register empty, Rx PDF 403); the edit-patient
  modal still shows editable allergy fields (a change is refused with a fixed text) — V2-08 UI follow-up (R-8).

## Lanes (final, tool output in `evidence/05a/05-02b/`)

Code at `01e9a93`:
- `npm run typecheck` clean; `npx eslint .` 0 errors (387 warnings, pre-existing kinds); `npm run inventory` exit 0;
  `npm run authz:gen -- --check` clean; `npm run db:drift:local` PASS (`static-checks.txt`).
- pgTAP lane: 11 files, **2601 tests, PASS** (2559 + 42 `domain_policies`; the matrix keeps 2244 cells); report gate
  PASS (`pgtap-lane.tap`).
- Full Vitest: **4527 tests, 4527 passed, 0 failed**, 225 files (`vitest-full.txt`; run on the feat commit with the
  new spec files; the later fix touches only modal markup no Vitest file renders). The first full run (before the
  spec adaptations in deviation 6) had 24 failures, all of the kinds listed there.
- E2E PR lane (desktop-chrome, Pixel 7, iPhone 15): **214 passed, 9 skipped** (pre-existing project-scoped skips),
  **0 retried / 0 flaky** (`e2e-pr.txt`), including M0 consult-rx-finish (doctor routes to reception), M0
  checkout-collect (receptionist collects), journey 8 and the 6 new Sign & Bill screens. The first PR-lane run failed
  the 3 owner screens on axe `label` (the v1 toggle had no name): fixed in `c5735c7`, then the whole lane re-run. Web
  server log: the 8 known `/patients` `request.error` lines (revoked-session pages, assigned to the 05a fix plan)
  and 1 deliberate `/api/diag/error` `DIAG_SYNTHETIC`.
- Screens (`screens/`): Sign & Bill for the doctor (note, "Sign & Route to Reception", no toggle) and the owner (toggle,
  "Sign & Collect") at 360/820/1280. Axe in the dialog: only the 3 v1 `color-contrast` nodes of the clinical summary
  labels (`text-gray-400` 10 px, in the M0 baseline rule set; design system V2-06); nothing in the 05-02b additions;
  page-level rules equal the baseline set of `/consultation/[id]`.
- `types/database.ts`: `npm run db:types` produced no change. gitleaks: no leaks found.

## Self-Check

PASSED. Files present: the three migrations, `domain_policies.test.sql`, `collect-permission.spec.ts`,
`receptionist-registration.spec.ts`, `sign-and-bill-screens.spec.ts`, evidence (`static-checks.txt`,
`pgtap-lane.tap`, `pgtap-without-05-02b.tap`, `specs-without-05-02b-migrations.txt`,
`specs-without-service-change.txt`, `vitest-full.txt`, `e2e-pr.txt`, `screens/`); commits `63412af`, `c5735c7`,
`01e9a93` are ancestors of HEAD (`git rev-list --count 2ede10f..01e9a93` = 3); the local stack is at 000056
(`db reset --local` after the without-migrations run).
