# V2-10 research notes (inventory at c609907a, read-only; re-check line numbers at execution)

## Schema
- Fees on `tenants` only: `default_consultation_fee NUMERIC(10,2) DEFAULT 500.00`, `default_followup_fee DEFAULT 300.00`,
  `accepted_payment_methods` (000009:5-9); `gstin` (000018:181). A fee change bumps no `settings` version (`cv_tenants_update`, 000123:315, 000132:31).
- `invoices` (000009:12-26): subtotal/discount/tax/total `NUMERIC(10,2)`; status CHECK `draft, issued, paid, cancelled`; `UNIQUE(tenant_id, invoice_number)`;
  `location_id` (000095); `row_version` (000123:369, trigger 000123:393-416: status, total, subtotal, discount, tax).
  One live per visit: `invoices_one_live_per_visit ... WHERE status <> 'cancelled'` (000024:296). No money CHECKs; insert guard trigger (000072:39-64).
  `authenticated`: SELECT only (INSERT revoked 000099:1884; UPDATE 000072:36-37; DELETE 000059:57).
- `invoice_items`: CHECKs `unit_price >= 0`, `total_price = round(unit_price*qty,2)` (000075:315-318, validated 000076); guards
  `invoice_items_integrity_guard` (000075:222-312: INVOICE_ITEMS_LOCKED on paid/cancelled, INVOICE_BELOW_COLLECTED, key immutable),
  `invoice_items_sync_invoice` (000075:325). **`authenticated` still has INSERT/UPDATE/DELETE** (RLS 000056:90-147, delete 000052:49).
- `payments`: `amount > 0`, method `cash|upi|card` (000009:42-52); `command_id` unique per tenant, actor CHECKs (000027:32-46); SELECT only for clients.
- Numbering: `generate_tenant_invoice_number` (000056:173-197, DEFINER) = `INV-YYYY-NNNNN` by counting this calendar year's rows (UTC);
  serialised by `pg_advisory_xact_lock` (000099:603); EXECUTE still granted to `authenticated` (000019:255).
- Billing domain triggers: 000123:199-248 (invoices insert/update of total or status, items i/u/d, payments i/u).

## Commands (all DEFINER, `search_path=''`, `lock_timeout 2s`)
- `private.step_create_invoice` (000099:541-629): returns the existing live invoice; caps total 1e8; inserts `issued`; no visit-status guard.
- `public.create_invoice(..., p_discount, p_tax)` (000099:631-700): no expected version (000126:16).
- `public.collect_payment(..., p_expected_invoice_version)` (000126:830-923); `private.step_record_payment` (000096:188-298, OVERPAYMENT at :242);
  `public.record_payment(..., p_expected_invoice_version)` (000126:925-961; `service_role` too).
- `public.complete_and_bill(..., p_expected_version)` (000126:680-825): ALREADY_BILLED, ROW_CHANGED on `visits.row_version`.
- Missing: cancel, void, refund, item commands.

## App
- `features/billing/actions.ts:39-127`; RPCs via `callCommand` (service.ts:212, :328, :920-937), `record_payment` at :444.
- Direct writes: `addInvoiceItem` insert (service.ts:697), `deleteInvoiceItem` delete (:765), no version.
- Money: rupee decimals; `toPaise()` only rounds (service.ts:473); `formatRupees` (features/today/schema.ts:381-384); inline `toLocaleString("en-IN")`
  (collection-reports-view.tsx:233-303, visits-register-view.tsx:265); `toFixed(2)` in the receipt PDF. No `lib/money`, no `lib/fy`.
- Sign & Bill: `components/consultation/sign-and-bill-modal.tsx:77` `defaultFee = 500`, :89 state from it; caller
  `consult-workspace.tsx:1190-1204` passes none; submit :206-219 sends no `expected_version` (schema.ts:130 and service.ts:932 support it).
- Checkout drawer: `defaultFee = 500` (:74), fallback (:152), chips `[300,500,800,1000]` (:743), item edits (:216, :262), `expected_invoice_version` (:356).
- Pages: `/billing/register` redirects to `/billing/reports` (collection-reports-view + receipt-modal). Receipt PDF route
  `app/api/invoices/[id]/receipt-pdf/route.ts` (`REC-${invoice_number}` :133); "Tax / GST" line receipt-document.tsx:447; GSTIN :333-334. No print CSS.
- Guard manifest `tests/security/guard-manifest.ts:181-191`, receipt route :344, :397. `command-latency.ts` :157, :162, :205.
  Lane rows `in-app.O.billing-reports` (:85), `full.R.billing-reports` (:94), `save.R.collect` (:115).

## Tests
- `tests/billing/*` (11 specs), `tests/integration/per-visit-billing.spec.ts`, `tests/helpers/billing-commands.ts`; pgTAP `billing_rpc_only` plus
  invoice cases in `reverify_integrity`, `stale_write_refusal`, `clinic_versions`, `delete_rules`, `domain_policies`, `today_signals`, `definer_functions`.
- e2e `tests/e2e/m0/checkout-collect.spec.ts`, `a11y/sign-and-bill-screens.spec.ts`, `live/stale-write.spec.ts`. Journey 7 missing.

## Hand-offs collected
09E-PLAN:930-931 and 000126:16 (item commands, versions); 09E-NOTES:576, :1479, :1603 (Sign & Bill version and ₹500); 09D A-12
(receipt doctor name from JWT metadata; 09D-SUMMARY:52); 09C-PLAN:494, :514 (receipt print, invoice share); 09A-PLAN:269, :289 (paid-invoice
protection); 08-PLAN:187, :258, :327 (lib/money, Collections page, SaveStatus); 07-SUMMARY:32, :45 (item atomicity, FY counter);
06-PLAN:1727 (MoneyInput); 06-08-CLOSE-OUT:102 (React Compiler waivers on checkout-drawer and receipt-modal, expire 2027-02-13).

## Rulings
PO-4 (VERIFICATION_LOG:338); O12 (:317, doctors view own-visit invoices and Sign & Bill, never collect a paid edit or refund); D14 (:76);
DB-10/11 (:95); C28 billing retention pending (:229); PO-20/C44 GST on the SaaS price only (:417, :424). UX_AUDIT:863 assumes consultations GST-exempt.
