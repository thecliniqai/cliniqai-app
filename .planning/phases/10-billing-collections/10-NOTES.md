# V2-10 Billing and collections: execution notes

Executor: Claude (Opus), CTO authority delegated by the PO (hard target 6 Dec 2026). Counts and results below are copied
from tool output; evidence lives in `evidence/` and the CI run.

## Executor decisions (one line each)

| # | Decision | Rationale |
|---|---|---|
| E-1 | Branch is `v2/phase-10-billing` (off `feature/v2` at 3e8f5608), not `v2/phase-10-billing-collections` as the plan says. | The plan's branch name is already taken by an old, merged branch on origin; the delegation brief names `v2/phase-10-billing`. |
| E-2 | Planner recommendations X-1 (keep `NUMERIC(10,2)`) and X-2 (separate `invoice_refunds` table) accepted as written. | Accepted by the PO's delegation brief. |
| E-3 | Both reviews (independent and adversarial) are run by fresh Opus agents, not Sonnet + Opus. | The delegation brief asks for Opus for both; billing is security-sensitive. |
| E-4 | Plans 10-01..10-05 are built one at a time by fresh Opus executor agents on the one local stack, with `npm run stack:recycle` between them. | Keeps each executor's context on one plan; the stack is single-user. |
| E-5 | Git identity for commits is `Claude <noreply@anthropic.com>` passed per command (`git -c user.name=… -c user.email=…`). | The checkout has no configured identity; this matches earlier Claude commits; no config change. |
| E-6 | The receipt PDF prints amounts with `formatINRAscii` (`Rs. 650`, `-Rs. 50`), not `formatINR`. | The PDF uses the standard Helvetica font (WinAnsi): `₹` drew as `¹` and U+2212 as a control character (probe in 10-01 notes); a font with the rupee sign is 10-05's letterhead work. |
| E-7 | `private.next_invoice_number(p_tenant_id, p_at timestamptz DEFAULT now())` takes the instant as a parameter; `SET lock_timeout = '5s'`. | No API grant, so the parameter is not a client lever; lets pgTAP and Vitest inject 31 Mar 23:59 / 1 Apr 00:00; 5 s as `next_queue_token` (000064) for the wait on the counter row. |
| E-8 | `VISIT_NOT_BILLABLE` is raised after the existing-live-invoice return in `step_create_invoice`. | D-8 forbids creating; a visit billed before it was cancelled still answers its own bill (collect/complete commands keep working on it). |
| E-9 | `step_create_invoice` refuses a discount above the subtotal with `INPUT_INVALID` (it used to clamp the total to 0). | The new CHECK `invoices_discount_within_subtotal` would refuse it anyway; a P0001 reason keeps it a validation error. |
| E-10 | The `money-format` ui-policy rule is enforced and also flags JSX `₹{amount}`; two files are exempt by name (`checkout-drawer.tsx`, `sign-and-bill-modal.tsx`, rewritten by 10-02/10-03). `read-only-encounter-modal.tsx`, `patient-visit-history.tsx` and `features/notifications/triggers.ts` were migrated as well as the listed files. | "Error level for new code" with zero repo findings; the exempt list shrinks in the plans that rewrite those screens. |
| E-11 | Invoice download names go through `invoiceFileStem` (`INV/2026-27/00001` → `INV-2026-27-00001`) in the receipt route and the receipt modal. | The FY number's slashes are path separators in `Content-Disposition` and `a.download`. |
| E-12 | Lane ceilings were not lowered (measured `save.R.collect` 9/7, `in-app.O.billing-reports` 3/2 against ceilings 10/9 and 3/3). | Not required by the plan; lowering from one run is left to the phase close's evidence run. |
| E-13 | The FY case table is `tests/fixtures/fy-cases.json`, embedded verbatim between `-- fy-cases:begin/end` in `billing_invariants.test.sql`; `tests/money/fy.spec.ts` checks the embedded copy equals the file and runs `private.indian_fy` on every case through the local superuser. | pgTAP cannot read a file; equality of the two copies plus both twins on one table is the parity. |
| E-14 | Existing fixtures that insert invoice headers directly now give `subtotal` = `total_amount`; the clinic_versions "not listed" probe changes discount and subtotal with the total unchanged; `create-invoice-rpc` R-6 now collides on a pre-written next number instead of deleting an older invoice. | Required by the new identity CHECK and the counter (the count-based collision no longer exists). |
| E-15 | `sign_and_bill_context` answers for `billing:collect` (any visit of the clinic) or `consultations:edit` on the visit's own doctor; the action's static guard is `consultations:edit` (the screen is the doctor's). pgTAP's "receptionist without billing:collect" case is the nurse (a receptionist holds billing:collect and answers). | The plan's gate; the receptionist role always holds billing:collect (PO-3). |
| E-16 | The context is held in a TanStack query keyed `[tenant, "sign-and-bill", visit]`, read when the sheet opens, removed when it closes (no focus/reconnect re-read); the fee is seeded once per open, so the re-read after `ROW_CHANGED` refreshes only the version and keeps what the doctor typed. Sign is disabled until the context answered. | D-10 "one read on open"; the refusal needs a fresh version, the doctor's input must survive. |
| E-17 | `completeAndBillConsultation` (action) requires `expected_version` at type level (`CompleteAndBillRequest`) and at run time (`expectedVersionError`, as 09E-14a (E) did for the other actions); the service keeps it optional for system/test callers. `completeAndBillSchema.consultation_fee` lost its `.default(500)` (a call without a fee is VALIDATION_FAILED "Enter the consultation fee."). | Closes 09E-07 PO question 1 and the last ₹500 literal. |
| E-18 | Fee chips (modal and drawer) are a `ChipGroup type="single"` of the clinic's consultation and follow-up fee (deduplicated, a fee not set is not offered); "the current amount" is the selected state, not a third chip. The modal also shows only the clinic's accepted methods and a note when the desk billed first. | D-11; one V2-06 part for both screens. |
| E-19 | The drawer was converted to `lib/money` for every amount it shows (`inr()` = `formatINR(toPaise(x))`) and its consultation fee to `MoneyInput`; its other number inputs (discount, amount to collect, custom charge) stay for 10-03. Both files left the `money-format` exemption list (now empty; the fixture of the drawer is a finding again). | F-3; the remaining inputs belong to 10-03's line-command rewrite. |
| E-20 | Lane: `open.D.sign-and-bill` is a new kind `open` (a sheet's own read; RSC enforced as a save, `latency-run.ts`); `save.D.sign-and-bill` is the same press as `save.D.sign-finish` on the new path. Their ceilings were merged into `latency-ceilings.json` from this plan's lane summary with a script reading the JSON (the ceilings tool rewrites every row from one summary, which would have dropped the others). `save.D.sign-finish` now waits for the context before its click. | Rows at the measured value (lane rule); no other ceiling touched. |

## Forward-fix items

- F-1 (10-01, fixed): the receipt PDF has drawn `₹` as `¹` since v1 (Helvetica/WinAnsi has no U+20B9); now `Rs.` via `formatINRAscii`. 10-05: embed a font with `₹` and switch the PDF to `formatINR`.
- F-2 (10-03): deleting or lowering invoice items below the discount now fails with 23514 `invoices_discount_within_subtotal` (direct item writes until 10-03); the item commands should raise a named P0001 reason first.
- F-3 (10-02/10-03): `checkout-drawer.tsx` and `sign-and-bill-modal.tsx` still build `₹` text by hand; remove them from the `money-format` exempt list when rewritten.
- F-5 (10-04): `sign_and_bill_context.invoice.paid` is the sum of payments; once `invoice_refunds` exists it must be net of refunds (`private.invoice_balance`).
- F-4 (10-04, when `void` is first written): live-invoice predicates that still read `status <> 'cancelled'` (000126 `complete_and_bill`/`collect_payment` ALREADY_BILLED and lookup at :780, :897; 000124 consult_screen, 000125 today_board) and the zod enums `z.enum(["draft","issued","paid","cancelled"])` in `features/billing/service.ts` (:144, :386) and `receipt-document.tsx` (:63) must admit/exclude `void`.

## 10-01 Money, FY numbering and header invariants (tracer)

Migration `supabase/migrations/000140_billing_invariants_fy.sql` (security-sensitive). Executor: Claude (Opus), one run on the local stack.

### Changes
- **Migration 000140**: `private.indian_fy(date)` (IMMUTABLE); `private.invoice_counters (tenant_id, fy, last_value)` PK `(tenant_id, fy)`,
  FK tenants CASCADE, RLS on, no policy, REVOKE ALL from PUBLIC/anon/authenticated/service_role (seeded from any `INV/<fy>/N` row: none);
  `private.next_invoice_number(p_tenant_id, p_at DEFAULT now())` → `INV/<fy>/<5 digits>` (wider past 99999) via one
  `INSERT … ON CONFLICT DO UPDATE … RETURNING`, FY from `public.tenant_local_date`, no API grant; `private.step_create_invoice`
  takes its number from it (advisory lock and count-based generator gone), skips `void` in the live lookup, raises
  `VISIT_NOT_BILLABLE` for a new bill on a `cancelled`/`no_show` visit, `INPUT_INVALID` for discount > subtotal;
  `public.generate_tenant_invoice_number` dropped (its only caller moved); header CHECKs `invoices_{subtotal,discount,tax,total}_nonnegative`,
  `invoices_discount_within_subtotal`, `invoices_total_identity`, `invoices_total_cap` added NOT VALID then validated (the fix-up
  UPDATE before them corrected 0 rows on the reset local stack; it raises the count as a NOTICE on any other database);
  `invoices_status_check` adds `void`; `invoices_one_live_per_visit` recreated `WHERE status NOT IN ('cancelled','void')`.
- **lib/money** (`format.ts`, `parse.ts`, `index.ts`): `formatINR(paise)` (`₹1,25,000`, `₹499.50`, `−₹50` with U+2212; own en-IN
  grouping, not ICU), `formatINRAscii` (PDF standard fonts, E-6), `formatINRPlain` (field text), `parseINR(text) → paise | null`,
  `toPaise` (number or numeric text, exact for 2 decimals), `fromPaise`, `roundRupees`, `MAX_MONEY_PAISE`.
- **lib/fy/index.ts**: `indianFy(ymd)`, `indianFyAt(instant, tz)`, `isFy`, `fyBounds`. Case table `tests/fixtures/fy-cases.json` (E-13).
- **components/ui/money-input.tsx** (new; none existed): ₹ adornment, `decimal` kind, grouping stripped on focus and en-IN on blur,
  emits integer paise (`moneyInputValue`), bounds by `maxPaise`. Not yet used by a screen (10-02 Sign & Bill, 10-03 drawer).
- **Formatter migration**: `features/today/schema.ts` `formatRupees` removed (callers `components/today/{today-row,visit-detail}.tsx`
  use `formatINR(toPaise(x))`); `components/billing/collection-reports-view.tsx` (7 sites), `components/visits/visits-register-view.tsx`
  (3), `features/billing/pdf/receipt-document.tsx` (11, `formatINRAscii`/`formatINRPlain`; column heads `Rate (Rs.)`, `Total (Rs.)`),
  plus `read-only-encounter-modal.tsx` (3), `patient-visit-history.tsx` (2), `features/notifications/triggers.ts` (1).
  `features/billing/service.ts`: the misnamed local `toPaise` (it rounded rupees) is `toRupeeParam` over `lib/money` `roundRupees`;
  `VISIT_NOT_BILLABLE` message added to the invoice and Sign & Bill message maps. `features/billing/schema.ts`: `invoiceFileStem` (E-11).
- **ui-policy**: new enforced rule `scripts/ci/ui-policy/rules/money-format.mjs` (E-10), baseline `money-format: 0`, fixtures
  `lint-fixtures/ui-policy/money-format/`, spec `tests/ci/ui-policy-money-format.spec.ts`.
- **Registries**: `expected-migration.ts` 000134 → 000140; `npm run db:types` (`types/database.ts`: the dropped function's 4 lines);
  schema snapshot written and `--check` PASS (3022 lines); `assert-pgtap-report.mjs` FLOOR 9892 → 9920 with the arithmetic
  (+ billing_invariants 37, − domain_policies 6, − definer_functions 3) and REQUIRED_FILES + `billing_invariants.test.sql`;
  `assert-vitest-report.mjs` REQUIRED_FILES + 4 specs; `lib/db/errors.ts` `VISIT_NOT_BILLABLE: CONFLICT`. No action, route or
  command added or removed (guard manifest, command catalog unchanged). `scripts/db/diagnostics.sql` D7e accepts the FY form.

### Deviations
- PDF money uses `Rs.` instead of `₹` (E-6; F-1). Discount > subtotal is now refused, not clamped (E-9).
- `domain_policies.test.sql` section 3 (10 cases on the dropped function) became 4 cases (dropped; receptionist, doctor, anon refused
  on `private.next_invoice_number`); `definer_functions.test.sql` lost the function's classification, grant entry and 3 legs.

### Affected-test discovery (grep from the plan, narrowed)
`grep -rn "INV-\|generate_tenant_invoice_number\|formatRupees\|toLocaleString(\"en-IN\"" tests scripts supabase/tests` hits changed:
`tests/security/membership-guard.spec.ts` (3 calls), `tests/billing/{create-invoice,collect-payment}-rpc.spec.ts` (number regex),
`tests/integration/receipt-reports.spec.ts` (regex), `tests/today/schema.spec.ts` (formatRupees case removed; covered by money.spec),
`supabase/tests/database/{domain_policies,definer_functions}.test.sql`, `scripts/db/diagnostics.sql`. Hits left as they are (synthetic
fixture numbers or message mocks, not the generator's format): `INV-SYN-*`, `INV-GUARD-*`, `INV-REG-*`, `INV-PDFH-*`, `INV-HIST-*`,
`INV-E2E-*`, `INV-PWA-*`, `INV-2026-00NN` in messaging/dpdp/sign-and-bill-outcome mocks and `whatsapp-templates.json` examples.
The new CHECKs broke header fixtures that set `total_amount` without `subtotal` (E-14): pgTAP `admin_policies`, `audit_v2`, `grants`,
`storage_policies`, `definer_functions`, `clinic_versions`, `front_desk_review_fixes`, `today_signals`, `today_board`,
`stale_write_refusal`, `domain_policies`, `billing_rpc_only` (one header 300/20/5 had total 1 → 285); Vitest
`tests/storage/storage-policies-jwt`, `tests/subscriptions/lock-enforcement`, `tests/today/{get-today-board,today-board-parity}`,
`tests/realtime/today-signals`; e2e helpers `tests/e2e/support/today-data.ts`, `tests/e2e/live/stale-write.spec.ts`.
`complete-and-bill-rpc` failed on `expectDataOnlyStoredResult` (the number now has `/`): `tests/helpers/billing-commands.ts` admits `/`.

### Commands run (counts copied from tool output)
- `npx supabase db reset --local`: `Applying migration 000140_billing_invariants_fy.sql...` `Finished supabase db reset`.
- `npx supabase test db supabase/tests/database/billing_invariants.test.sql`: `Files=1, Tests=37` `Result: PASS`.
- Full pgTAP lane `npm run test:pgtap` + `node scripts/ci/assert-pgtap-report.mjs`:
  `pgtap-report-gate: files=82 tests=9920 passed=9920 failed=0 skipped/todo=0 floor=9920 required=82` / `PASS`.
- Vitest: `tests/money` `Tests 67 passed (67)`; `tests/billing/fy-numbering-db.spec.ts` `Tests 6 passed (6)`; ui-policy specs +
  today/schema `Test Files 3 passed (3)` `Tests 27 passed (27)`. First affected run (47 files, before the fixture fixes):
  `Test Files 9 failed | 38 passed (47)` `Tests 6 failed | 806 passed | 41 skipped (853)`; the 10 failing/changed files re-run:
  `Test Files 10 passed (10)` `Tests 212 passed (212)`. Final affected run (affected list + tests/ci, tests/money, tests/billing, readiness probe, error map): `Test Files 83 passed (83)` `Tests 1327 passed (1327)`.
- `npm run typecheck`: clean. `npx eslint .`: `✖ 392 problems (0 errors, 392 warnings)` (none in the new files). `npm run inventory`: exit 0.
  `npm run ci:ui-policy`: `money-format [enforce] 0 finding(s)` `ui-policy: PASS`.
- `npm run e2e:build`: exit 0 (`output scan clean (1872 files)`). `npx playwright test tests/e2e/m0/checkout-collect.spec.ts
  tests/e2e/live/stale-write.spec.ts tests/e2e/a11y/front-desk-screens.spec.ts --project=desktop-chrome --project=pixel-7
  --project=iphone-15 --retries=0`: `27 passed (1.8m)`.

### Lane rows (`npm run perf:latency -- --grep "save.R.collect|in-app.O.billing-reports"`, 300 ms, 5 samples; copy in `evidence/10-01/lane-rows-300ms.json`)
```
{"id": "in-app.O.billing-reports", "calls": {"median": 3, "max": 3}, "depth": {"median": 2, "max": 2}, "ms": {"median": 688.2, "max": 697.6}, "targetMs": 1000, "verdict": "within target", "ceiling": {"maxCalls": 3, "maxDepth": 3}}
{"id": "save.R.collect", "calls": {"median": 9, "max": 9}, "depth": {"median": 7, "max": 7}, "ms": {"median": 2053.3, "max": 2076.2}, "targetMs": 500, "verdict": "over target", "ceiling": {"maxCalls": 10, "maxDepth": 9}}
```
Neither row rose (calls and depth at or under their ceilings; `10 passed (2.1m)`). `save.R.collect` ms is over its report-only target as before.

### Fails-without (High: numbering gaps / duplicates, T-10-03)
Local-only edit: `private.next_invoice_number` replaced (psql as the local superuser) by the pre-000140 rule, `count(*) + 1` of the
clinic's FY numbers with no counter row and no lock; `npx vitest run tests/billing/fy-numbering-db.spec.ts -t "50 parallel"`:
```
× FY numbering: concurrency > 50 parallel creates on 50 visits of one clinic → 00001..00050, no gap, no duplicate 1995ms
  → expected [ '23505', '23505', null, null, …(46) ] to deeply equal [ null, null, null, null, null, …(45) ]
```
Restored by re-applying the migration's function definition; the same case `Tests 1 passed | 5 skipped (6)`; schema snapshot
`--check` PASS afterwards (the definition equals the migration's).

Probe for E-6/F-1 (a throwaway spec, deleted): Helvetica text `"A ₹1,25,000 B −₹50 …"` read back from the PDF as
`"A ¹1,25,000 B \u0012¹50 …"`. The tracer case now asserts the receipt text has the number, `Rs. 650`, and no `¹`.

### Security-sensitive files
`supabase/migrations/000140_billing_invariants_fy.sql`, `supabase/tests/database/billing_invariants.test.sql`,
`features/billing/service.ts`, `features/billing/schema.ts`, `features/billing/pdf/receipt-document.tsx`,
`app/api/invoices/[id]/receipt-pdf/route.ts` (file name only), `lib/db/errors.ts`, `supabase/tests/database/{domain_policies,definer_functions}.test.sql`.

## 10-02 Sign & Bill from the clinic fee, with the visit version

Migration `supabase/migrations/000141_sign_and_bill_context.sql` (security-sensitive). Executor: Claude (Opus), one run on the local stack (recycled
before the run by the orchestrator; not recycled during it). Closes the two items 09E deferred (09E-NOTES N-3 / PO question 2: Sign & Bill pre-filled ₹500;
09E-07 PO question 1: Sign & Bill sent no visit version).

### Changes
- **Migration 000141**: `public.sign_and_bill_context(p_tenant_id, p_visit_id)` STABLE INVOKER, `search_path ''`, EXECUTE for `authenticated` only
  (REVOKE PUBLIC, anon, service_role) → `{fee: {consultation, followup}, methods, visit: {id, row_version, status}, invoice: {id, row_version, total, paid} | null}`;
  NULL without a session, for a NULL argument, a tenant that is not the active full clinic (`has_permission`), a role with neither `billing:collect` nor
  `consultations:edit`, another doctor's visit without `billing:collect`, a visit not in the tenant. Live invoice = status not cancelled/void; paid = Σ payments.
  `consult_screen` unchanged. No table, policy, trigger or grant change beyond EXECUTE.
- **Service/action/schema**: `getSignAndBillContext` (service: permission check, uuid check, RPC, NULL → NOT_FOUND, shape parse, rupees → paise; action:
  `consultations:edit`). `completeAndBillConsultation` action takes `CompleteAndBillRequest` (requires `expected_version`, also checked at run time with
  `expectedVersionError`). `completeAndBillSchema.consultation_fee` has no default (was `.default(500)`). `getVisitBillingDetails` also returns
  `clinicFollowupFee`. `SignAndBillContext` / `signAndBillContextRowSchema` in `schema.ts`; `queryKeys.signAndBill`.
- **Sign & Bill modal**: the context query on open (E-16), fee and discount as `MoneyInput` (paise), fee seeded once from the clinic fee, null fee → empty
  required field with "Enter the consultation fee." on Sign (no default), discount > fee refused on the client, fee chips from the clinic fees (E-18), only
  the clinic's accepted methods, a note when the desk billed first, Sign disabled until the context answered (a failed read shows the fixed text and Try
  again), `expected_version` from the context, on `ROW_CHANGED` the fixed message stays, the context is re-read and the input kept, `SaveStatus` in the
  footer (no Retry for ROW_CHANGED), every amount via `formatINR`. Caller `consult-workspace.tsx` passes `tenantId`.
- **Checkout drawer**: dead `defaultFee = 500` prop removed (fallback was ₹500; now an empty fee and Collect disabled until a fee is entered), fee chips
  from the clinic's consultation/follow-up fee (no `[300,500,800,1000]`), consultation fee as `MoneyInput`, every amount via `formatINR` (E-19),
  `SaveStatus` beside Collect (Retry = same request id; none for ROW_CHANGED).
- **PWA-06b**: both saves go through `useConfirmedCall` → `useCommand` (15 s timeout, one retry with the same request id, pre-existing) and now show
  `SaveStatus`; e2e proves the retry with the same id on the modal.
- **money-format** exemption list emptied (F-3 done for 10-02's part); its fixture of the drawer is a finding again; spec updated.
- **Registries**: `expected-migration.ts` 000140 → 000141; `npm run db:types` (+4 lines); schema snapshot written, `--check` PASS (3024 lines);
  `assert-pgtap-report.mjs` FLOOR 9920 → 9950 (+ sign_and_bill_context 30, 83 files) and REQUIRED_FILES; `assert-vitest-report.mjs` REQUIRED_FILES +
  `tests/billing/sign-and-bill-context.spec.ts`; guard manifest + `getSignAndBillContext: consultations:edit`; `valid-inputs.ts` sends the waiting visit's
  current version with the completeAndBill control; `command-latency.ts` `read: sign_and_bill_context`. No new command (catalog unchanged), no new P0001
  reason (`lib/db/errors.ts` unchanged; ROW_CHANGED already mapped).
- **Lane**: new kind `open`; rows `open.D.sign-and-bill` (`@budget`) and `save.D.sign-and-bill`; `save.D.sign-finish` waits for the context (E-20).

### Deviations
- `open.D.sign-and-bill` measured **2 calls / depth 2**, not the plan's 1 / 1: the extra call is the pre-existing `GET /rest/v1/prescriptions` of
  `rx.reconcile()` in the workspace's Finish handler (09C), before the sheet opens; the context itself is 1 call. Starting the context read in parallel would
  not help (server actions run one at a time in the Next client). Ceiling set at the measured 2 / 2.
- `save.D.sign-and-bill` measured **57 / 33** (plan B-8 ≤ 2 / ≤ 2 not met), the same as `save.D.sign-finish` (57 / 33, ceiling 58 / 34, not raised): the
  post-commit PDF/receipt work and the sealed-record refresh documented in 09E-NOTES "Sign and finish: measured and reported". Unchanged by this plan.
- pgTAP "receptionist without billing:collect" is the nurse case (E-15). journey-08 "nurse signing from the direct URL": the refusal now comes from the
  context read when the sheet opens (DENIED shown, Sign disabled); the sign-off action's own refusal of the role is in guard-actions.
- The fails-without e2e shows the stale sign refused as ALREADY_SIGNED (the desk completion also trips the sign step) rather than signed; the Vitest
  fails-without (below) shows the actual lost update (the stale sign signs and bills).

### Grep hits
- Affected-test discovery (`grep -rln "defaultFee\|sign-and-bill\|checkout-drawer\|completeAndBill\|complete_and_bill\|consultation_fee\|queryKeys\|clinicFee\|sign_and_bill\|money-format\|EXPECTED_MIGRATION\|guard-manifest" tests scripts`, non-e2e): 37 files; the Vitest run below covers them. e2e: `grep -rn "Sign & \|Consultation Fee\|Collect ₹" tests/e2e` → the specs in the e2e run below.
- `grep -rn "500" components/queue components/consultation` → 59 lines: Tailwind colour classes (`*-500`), `maxLength={500}`, the amendment reason
  bound (`AMENDMENT_REASON_MAX = 500`), and one comment ("the old ₹500 default"). **No fee literal.**

### Commands run (counts copied from tool output)
- `npx supabase db reset --local`: `Finished supabase db reset on branch v2/phase-10-billing.`
- `npx supabase test db supabase/tests/database/sign_and_bill_context.test.sql`: `Files=1, Tests=30` `Result: PASS`.
- Full pgTAP `npm run test:pgtap` + gate: `pgtap-report-gate: files=83 tests=9950 passed=9950 failed=0 skipped/todo=0 floor=9950 required=83` / `PASS`.
- Vitest `tests/billing/sign-and-bill-context.spec.ts`: `Tests 8 passed (8)`. Affected run (api probes, sensitive-actions, table-matrix, tests/billing,
  tests/ci, consultation-service-guards, tests/query, schedule-range, guard-actions/canary/routes, review2/3 fixes, session bootstrap, settings,
  stale-write-services, tests/commands): `Test Files 69 passed (69)` `Tests 1718 passed (1718)`; re-run of guard-actions, tests/billing, money-format,
  sensitive-actions after the last edits: `Test Files 16 passed (16)` `Tests 965 passed (965)`.
- `npm run typecheck`: clean. `npx eslint .`: `✖ 391 problems (0 errors, 391 warnings)` (no new warning in the touched files). `npm run inventory`:
  `0 flagged, 7 noted`. `npm run ci:ui-policy`: `money-format [enforce] 0 finding(s)` `ui-policy: PASS`.
- `npm run e2e:build`: exit 0 (`output scan clean (1872 files)`). `npx playwright test tests/e2e/consult/sign-and-bill.spec.ts
  tests/e2e/a11y/sign-and-bill-screens.spec.ts tests/e2e/m0/checkout-collect.spec.ts tests/e2e/shell/bootstrap.spec.ts tests/e2e/live/stale-write.spec.ts
  tests/e2e/consult/finish-review.spec.ts tests/e2e/m0/consult-rx-finish.spec.ts tests/e2e/journeys/journey-06-consult.spec.ts
  tests/e2e/journeys/journey-08-role-restrictions.spec.ts tests/e2e/shell/confirm-saves.spec.ts --project=desktop-chrome --project=pixel-7
  --project=iphone-15 --retries=0`: `2 failed` `16 skipped` `89 passed (10.1m)` (the 2: journey-08 nurse, desktop-chrome and pixel-7, Sign now disabled
  for the role: spec updated); `journey-08-role-restrictions.spec.ts` on the three projects after the fix: `20 passed (47.9s)`.
  The axe spec (`a11y/sign-and-bill-screens`, 360/820/1280, doctor and owner, with the context answered, chips and MoneyInput on screen) passed in that run.

### Lane rows (`npm run perf:latency -- --grep "open.D.sign-and-bill|save.D.sign-and-bill|save.D.sign-finish"`, 300 ms, 5 samples: `11 passed (4.8m)`; copy in `evidence/10-02/lane-rows-300ms.json`)
```
{"id": "open.D.sign-and-bill", "calls": {"median": 2, "max": 2}, "depth": {"median": 2, "max": 2}, "ms": {"median": 800.6, "max": 823.8}, "targetMs": 1000, "verdict": "within target", "ceiling": null}
{"id": "save.D.sign-and-bill", "calls": {"median": 57, "max": 57}, "depth": {"median": 33, "max": 33}, "ms": {"median": 7490.9, "max": 7535}, "targetMs": 1000, "verdict": "over target", "ceiling": null}
{"id": "save.D.sign-finish", "calls": {"median": 57, "max": 57}, "depth": {"median": 33, "max": 33}, "ms": {"median": 7594.7, "max": 7691.3}, "targetMs": 1000, "verdict": "over target", "ceiling": {"maxCalls": 58, "maxDepth": 34, "source": ".planning/phases/09E-caching-speed/evidence/09E-12/schedule-rows-300ms.json#save.D.sign-finish"}}
```
RSC per sample: open 0,0,0,0,0; sign-and-bill 1,1,1,1,1 (maxRsc 1). `open.D.sign-and-bill` calls by path: `GET /rest/v1/prescriptions` 1,
`POST /rest/v1/rpc/sign_and_bill_context` 1. Ceilings for the two new rows merged from that summary (E-20): open 2 / 2, save 57 / 33.

### Fails-without (High: lost update on Sign & Bill, T-10-05)
1. Vitest (local-only edit of the spec, restored): the stale case sent without the version →
   `× … a visit that moved after the context was read is refused with ROW_CHANGED: nothing signed, no invoice` /
   `→ expected { success: true, …(10) } to deeply equal { success: false, …(3) }` (the stale sign-off signed and billed `INV/2026-27/00001`). Restored; `Tests 8 passed (8)`.
2. e2e (local-only edit: the modal sent no `expected_version` and the action's check skipped; rebuilt, run, restored, rebuilt):
   `Error: expect(locator).toBeVisible() failed … getByText('This changed on another device. The latest is shown.') … element(s) not found` (the sheet
   said "This consultation is already signed." instead). Restored; the stale case passes on the three projects in the run above.

### Security-sensitive files
`supabase/migrations/000141_sign_and_bill_context.sql`, `supabase/tests/database/sign_and_bill_context.test.sql`, `features/billing/{service,actions,schema}.ts`,
`tests/security/guard-manifest.ts`, `tests/security/guard/valid-inputs.ts`.
