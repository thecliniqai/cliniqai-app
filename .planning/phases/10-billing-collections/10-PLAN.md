---
phase: "10"
roadmap_id: V2-10
name: Billing and collections
revision: "2026-11-28, first (CTO authority delegated by the PO; deadline: all phases except go-live done by 6 Dec 2026)"
gate: "G4 (light, per PR): one isolated reviewer (Sonnet) over the money and FY helpers, the invoice line commands, cancel/void/refund, the Sign & Bill context, the collections register, receipt print and share, the lane rows; one adversarial security reviewer (Opus) over migrations 000140 to 000144, the revoked direct writes on invoice_items, the new billing:refund permission, every definer command (guard block, replay before compare, lock then compare, caps), billing_collections and sign_and_bill_context (another clinic, roles, fields), the receipt route; one fix round (10-06). Approval: the PO, or Claude under the delegated CTO authority with the CI run recorded."
requirements: ["P1-06 (PO-4: status guards, overpayment cap, cancel/void/refund, Indian-FY counter INV/2026-27/00001, shared lib/fy, money CHECKs, one active invoice per visit; no patient payment gateway)", "P1-33 (collect payment + collections, en-IN money)", "P2-10 (receipt print stylesheet and letterhead)", "P1-42 journey 7 (complete and bill -> partial cash -> UPI balance -> paid -> receipt)", "PWA-06b (client timeout, retry once, SaveStatus for the billing workflows)", "PWA-12 (Web Share of the receipt PDF)", "09E hand-offs: invoice-item table writes become commands with invoices.row_version; new billing commands take p_expected_version; Sign & Bill starts at Rs 500 instead of the clinic fee (09E N-3); Sign & Bill sends no visit version (09E-07 PO question 1)", "09D A-12: receipt doctor-name fallback from stale JWT metadata", "M4.5 criteria: amounts en-IN, paise round-trip exact, collect atomic, receipt share parity"]
plans: ["10-01", "10-02", "10-03", "10-04", "10-05", "10-06", "close"]
order: "10-01 -> 10-02 -> 10-03 -> 10-04 -> 10-05 -> reviews -> 10-06 -> close (sequential; one local stack; one executor)"
migrations: {"10-01": "000140_billing_invariants_fy", "10-02": "000141_sign_and_bill_context", "10-03": "000142_invoice_item_commands", "10-04": "000143_cancel_void_refund", "10-05": "000144_billing_collections", "10-06": "000145_review_fixes_10 (only if a fix needs SQL)"}
migrations_note: "Reserved range 000140-000149. 000134_command_versions is the newest on feature/v2 at c609907a; 000135-000139 stay unused unless another branch takes them (then keep the reserved numbers anyway; never renumber into another phase's range). Every migration commit also bumps app/api/ready/expected-migration.ts, the schema snapshot, types/database.ts (npm run db:types) and scripts/ci/assert-pgtap-report.mjs (REQUIRED_FILES, FLOOR with the arithmetic)."
new_dependencies: {}
base_commit: "c609907a (feature/v2, V2-09e merged)"
branch: "v2/phase-10-billing-collections -> one PR into feature/v2"
---

# V2-10 Billing and collections: plan

## Goal

A bill is correct by construction and quick to collect. The database decides every money rule: amounts cannot go negative
or past what was billed, a paid line cannot change, numbers run per Indian financial year with no gaps or reuse, mistakes are
corrected only by cancel (nothing collected), refund (part) or void (all money returned), and every one of those is one atomic
command that refuses a stale screen. The doctor's Sign & Bill starts from the clinic's fee and refuses a visit that moved. The
desk sees a paginated collections register with net totals by method and prints or shares an en-IN receipt.

Tracer: 10-01 numbers one invoice `INV/2026-27/00001` end to end (counter, command, receipt text, `formatINR`) before any
other change.

## Current state (inventory at c609907a; file:line in 10-RESEARCH-NOTES.md)

| Area | Today | Gap | Plan |
|---|---|---|---|
| Money columns | `invoices` subtotal/discount/tax/total `NUMERIC(10,2)`; no CHECKs (only an insert guard trigger, 000072); `invoice_items` CHECKs (000075/76); `payments.amount > 0` | CHECKs on the header; total identity; caps | 10-01 |
| Numbering | `generate_tenant_invoice_number` counts this calendar year's rows (UTC) under an advisory lock: `INV-YYYY-NNNNN`; still EXECUTE for `authenticated` | FY counter table, tenant-local date, `INV/2026-27/00001`, revoke | 10-01 |
| Status | CHECK `draft, issued, paid, cancelled`; no `void`; no refund model | `void`, `refunds` | 10-01, 10-04 |
| Create guard | `step_create_invoice` has no visit-status guard | refuse cancelled / no-show visits | 10-01 |
| Lines | `addInvoiceItem` / `deleteInvoiceItem` are direct table writes; `authenticated` holds INSERT/UPDATE/DELETE on `invoice_items`; no version | commands with `p_expected_version`; revoke | 10-03 |
| Edit after payment | items locked only when `paid`/`cancelled`; `INVOICE_BELOW_COLLECTED` otherwise | locked once any payment exists | 10-03 |
| Sign & Bill | `sign-and-bill-modal.tsx:77` `defaultFee = 500`; caller passes none; submit sends no `expected_version` though `complete_and_bill` supports it (000126) | one context read on open: fee + visit version | 10-02 |
| Desk drawer | reads the clinic fee (09E); fee chips hard-coded `[300,500,800,1000]`; `defaultFee = 500` prop left | chips from clinic fees; dead default removed | 10-02 |
| Money in TS | rupee decimals; `toPaise` only rounds; `formatRupees` in `features/today/schema.ts`; inline `toLocaleString` in two views; `toFixed(2)` in the PDF | `lib/money` (integer paise), `MoneyInput`, one formatter | 10-01 |
| Register | `/billing/reports` daily collection report (direct reads); `/billing/register` redirects | paginated collections register with URL filters | 10-05 |
| Receipt | PDF route `app/api/invoices/[id]/receipt-pdf`; no print CSS; doctor name from JWT metadata (A-12); "Tax / GST" line always shown | print CSS + letterhead, status/refunds on it, Web Share, name from the directory | 10-05 |
| Journey 7 | missing (`tests/e2e/journeys` has 01, 03-06, 08, 09) | add | 10-05 |

## DECISIONS (CTO, delegated; one line each; the PO may overturn at the gate)

| # | Decision | Rationale |
|---|---|---|
| D-1 | Keep `NUMERIC(10,2)` rupees in the database; `lib/money` works in integer paise and converts only at the service boundary (`toPaise`/`fromPaise`, exact for 2-decimal values). | DESIGN §7.7 asks for paise in the UI and "Workstream C to confirm column types"; a column-type migration buys nothing with CHECKs in place and risks every report. |
| D-2 | Statuses: `issued`, `paid`, `cancelled`, `void` (`draft` kept in the CHECK for old rows, never written). Balance is derived: total − payments + refunds. | Smallest model meeting PO-4; partial payment stays `issued` with a balance as today. |
| D-3 | **Cancel** = an invoice with no net money collected → `cancelled`; the visit can be billed again (the one-live index already excludes `cancelled`; it is widened to exclude `void`). **Refund** = a row in `public.invoice_refunds` (amount > 0, method, reason), total refunded ≤ total paid. **Void** = refund everything still held in one command, then `void`. | Matches how a clinic desk corrects mistakes; numbers are never reused or deleted. |
| D-4 | Lines lock as soon as any payment exists (not only when `paid`); to change a paid-against bill: refund or void, then bill again. | Roadmap acceptance "an edit after payment is rejected"; removes the `INVOICE_BELOW_COLLECTED` edge cases. |
| D-5 | New permission `billing:refund` (refund and void) for owner and admin only; cancel of an unpaid invoice needs `billing:collect`; doctors never refund (O12). Added to `lib/permissions/matrix.ts` and the SQL role table in the same migration, with the parity case. | Money leaving the clinic is the highest-risk desk action; O12 already rules doctors out. |
| D-6 | FY counter `private.invoice_counters(tenant_id, fy, last_value)` PK `(tenant_id, fy)`, incremented with `INSERT … ON CONFLICT DO UPDATE … RETURNING` inside the command (TARGET §7 rule 3). FY from the clinic-local date (`private.indian_fy(date)` → `2026-27`, April-March), twin `lib/fy` with one case table (SUB-05 reuses it). A rolled-back command rolls its increment back, so there are no gaps. | PO-4, ADR-016 (tenant-local time in one place). |
| D-7 | Existing `INV-YYYY-NNNNN` rows are left as they are (synthetic data only, PO-15); the counter starts at 1 per clinic per FY; uniqueness is unchanged. | No live data to migrate. |
| D-8 | Invoices may be created only for visits not `cancelled` or `no_show`. | Closes the missing status guard without blocking same-day desk billing of a waiting patient. |
| D-9 | Patient bills carry no GST: clinic healthcare services are GST-exempt; `tax` stays 0 and the "Tax / GST" line prints only when non-zero; the receipt shows the clinic GSTIN when one is set and is titled "Receipt". Pharmacy/product GST is v2.1 (inventory). | The roadmap's "GST-compliant" read as "no wrong tax shown"; PO-20/C44 apply GST to the SaaS price only. PO external action P-3 confirms with a CA. |
| D-10 | Sign & Bill makes one INVOKER read when it opens, `public.sign_and_bill_context(p_tenant_id, p_visit_id)`: clinic consultation and follow-up fee, accepted methods, the visit's `row_version`, the live invoice if any. `consult_screen` is not changed. | Fees are never held (09E R-13: "read with the bill"); a fresh version at open is what the refusal needs; one call, depth 1. |
| D-11 | Fee chips = the clinic's consultation and follow-up fee (and the current amount); no hard-coded amounts. Per-doctor fees are out (no column exists; v2.1 if asked). | Kills the last literal ₹500. |
| D-12 | Receipts are rendered on demand from database rows (no new stored object); "VOID" / "CANCELLED" / refunds printed on it. The 09C store-once rule stays for signed Rx only. | A receipt changes with refunds; there is no signed moment to preserve; saves Free-tier Storage. |
| D-13 | Collections register = one INVOKER read `public.billing_collections` with keyset pagination (cursor = `(recorded_at, id)`), 50 rows a page, filters in the URL (from, to, method, status, doctor, kind payment/refund); totals for the whole filter from the same statement. V2-11 registers reuse the same cursor helper (`lib/pagination/keyset.ts`). | M4.7 "paginated server-side, filters in the URL"; one pattern for both phases. |
| D-14 | `billing` stays a "changed elsewhere" screen (09E R-9), not a live board: the register shows the notice on a newer `billing` version and never re-renders itself. | Same as Billing reports today; no new live surface. |
| D-15 | `generate_tenant_invoice_number` is dropped (after its callers move) and EXECUTE on any numbering function is never granted to `authenticated`. | A callable counter lets a client burn numbers (gaps). |

## CTO decisions needed (true conflicts with approved docs; recommendation applies unless overturned)

| # | Conflict | Approved doc | Recommendation |
|---|---|---|---|
| X-1 | DESIGN_SYSTEM "Money (storage): integer paise" (:404) and §7.7 vs D-1 (numeric rupees kept) | DESIGN_SYSTEM.md:404, §7.7 | Keep numeric(10,2) (D-1); amend the table at the close to "UI and `lib/money` in paise; database `NUMERIC(10,2)` with CHECKs". |
| X-2 | V2-07 R-9 / 07-SUMMARY name a refund on `payments` (negative or reversal rows) vs D-3 separate `invoice_refunds` table | 07-SUMMARY (not an approved doc); TARGET silent | Separate table (keeps `payments.amount > 0` and every existing report correct); record in VERIFICATION_LOG at the close. |

## Shared rules for every plan (09E conventions)

- **Commands** follow the V2-07 pattern (07-PLAN "Command pattern"): `SECURITY DEFINER`, `search_path = ''`, `lock_timeout = '2s'`, the
  `record_payment` guard block (actor, `p_tenant_id` in `authz.full_tenant_ids()`, `has_permission`), `private.command_claim` replay
  **before** the version compare, lock the invoice (or visit) `FOR UPDATE`, then `ROW_CHANGED` (P0001) when `p_expected_version` differs
  (09E R-19; parameter last, `DEFAULT NULL`), invariants as `P0001` machine reasons registered in `lib/db/errors.ts`, audit via
  `public.log_audit`, outbox where a webhook exists, `private.command_complete`. Results carry the new `row_version` and `versions`
  (000134). `REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated`. Every new command: a catalog entry (`tests/helpers/command-catalog.ts`).
- **Reads** INVOKER, STABLE, tenant from the session checked with `has_permission` (forged tenant → nothing), narrowest output, versions from
  the same statement where the screen uses them; a pgTAP file each (grants, another clinic, roles, shape) and a `scripts/perf/command-latency.ts` entry.
- **Live**: every write moves the `billing` version through the existing statement triggers (000123); `invoice_refunds` gets the same trigger;
  a pgTAP case per new table/event that one transaction sends one signal.
- **Client**: `useConfirmedCommand` (09E-08) for every money save (pending only, never success before the database); one call per save, result
  applied with `setQueryData`; no `revalidatePath`; PWA-06b timeout + retry-once with the same request id; `ROW_CHANGED` shows "This changed
  on another device. The latest is shown." and re-reads.
- **Registries** in the migration's commit: `tests/security/guard-manifest.ts` and `npm run inventory` for every added/removed action or route;
  `grants.test.sql` grantee sets; schema snapshot (`node scripts/drift/schema-snapshot.mjs --local --write`, then `--check`); `npm run db:types`;
  `expected-migration.ts`; `assert-pgtap-report.mjs` and `assert-vitest-report.mjs` REQUIRED_FILES.
- **Lane rows** in `tests/e2e/perf/latency-budgets.ts` (calls and depth block, ms report-only, `maxRsc` 0 for saves): each plan adds its rows at
  the measured value and tags the CI subset `@budget`. A failing row is root-caused, never re-run to green.
- **Tests** assert real outcomes (rows, numbers, totals, statuses, audit rows, signals, DOM after reload). One fails-without proof per High
  control (listed per plan). e2e on desktop-chrome, pixel-7, iphone-15 (golden cases) with 0 retries; axe 0 serious/critical at 360, 820,
  1280 for every new sheet, dialog and page. Clock cases with `page.clock` / injected now; FY boundary cases at 31 Mar 23:59 and 1 Apr 00:00 IST.
- **UI**: V2-06 parts only (`MoneyInput`, `ResponsiveSheet`, `DataTable`, `Pagination`, `FilterChip`), no hex or raw palette class, `dvh`,
  44 px targets below 1024, `npm run ci:ui-policy` clean; no new React Compiler waiver (the drawer's waiver is removed if the rewrite allows).
- **Affected-test discovery** before editing: `grep -rln "addInvoiceItem\|deleteInvoiceItem\|invoice_items\|generate_tenant_invoice_number\|INV-\|formatRupees\|toLocaleString(\"en-IN\"\|defaultFee\|sign-and-bill\|checkout-drawer\|collection-reports\|receipt" tests scripts`, narrowed per plan. The grep is authoritative.
- **Run order** inside a plan: migration (`npx supabase db reset --local`, `npm run db:types`), service, UI, specs; affected Vitest + pgTAP,
  `npm run typecheck`, `npx eslint .`, `npm run inventory`, `npm run e2e:build`, the plan's e2e files, `npm run perf:latency -- --grep billing`.
  `npm run stack:recycle` before evidence and between executors. Never hosted Supabase, never `.env*`, synthetic data only.
- **Plan record**: append a section per plan to `10-NOTES.md` (changes, deviations, grep hits, commands with counts copied from tool output,
  lane rows with their JSON values, security-sensitive files). Evidence is never typed.

## Plans

### 10-01 Money, FY numbering and header invariants (tracer) · M · migration 000140_billing_invariants_fy

Goal: D-1, D-2, D-6 to D-8, D-15. One shared money and FY vocabulary; the database refuses bad headers and numbers per FY.

Files: new `lib/money/{index.ts,format.ts,parse.ts}` (`formatINR(paise)`, `parseINR(text) → paise | null`, `toPaise(numeric)`,
`fromPaise(paise)`, U+2212 minus), new `lib/fy/index.ts` (`indianFy(localDate) → "2026-27"`, `fyBounds`), `components/ui/money-input.tsx`
(DESIGN §7.7) if absent; `features/billing/{service,schema}.ts`, `features/today/schema.ts` (`formatRupees` → `formatINR`),
`components/billing/collection-reports-view.tsx`, `components/visits/visits-register-view.tsx`, `features/billing/pdf/receipt-document.tsx`
(formatter only); `supabase/migrations/000140_billing_invariants_fy.sql`; new `supabase/tests/database/billing_invariants.test.sql`;
new `tests/money/{money,fy}.spec.ts`, `tests/billing/fy-numbering-db.spec.ts`; a ui-policy guard banning `toLocaleString("en-IN"` and
literal `"₹" +` / `` `₹${ `` outside `lib/money` (error level for new code).

1. Tracer: `private.indian_fy(date)`, `private.invoice_counters`, `private.next_invoice_number(p_tenant_id)` (clinic-local date via
   `public.tenant_local_date`; `INV/<fy>/<5 digits>`), `step_create_invoice` switched to it; one Vitest DB case creates an invoice and reads
   `INV/2026-27/00001` (injected date), the receipt text prints it with `formatINR`.
2. Migration: header CHECKs (each ≥ 0; `discount ≤ subtotal`; `total_amount = subtotal − discount + tax`; `total_amount ≤ 1e8`), added
   `NOT VALID` then validated (synthetic rows fixed in the same migration if any violate, listed in the notes); status CHECK adds `void`;
   `invoices_one_live_per_visit` recreated `WHERE status NOT IN ('cancelled','void')`; `step_create_invoice` refuses `VISIT_NOT_BILLABLE`
   for `cancelled`/`no_show` (D-8); `generate_tenant_invoice_number` callers moved, then dropped (D-15); `invoice_counters` RLS on, no grants.
3. `lib/money` and `lib/fy` with their tables; every money display in the files above through `formatINR`; `MoneyInput` emits paise.
4. Specs below.

Tests: pgTAP `billing_invariants`: each CHECK refuses its violation; FY of 31 Mar 23:59 IST = previous FY, 1 Apr 00:00 = new FY (zone
`Asia/Kolkata` and one non-IST clinic); counter per clinic and FY; no EXECUTE on the numbering functions for `authenticated`/`anon`; the
widened one-live index. Vitest DB `fy-numbering-db.spec.ts`: **50 parallel creates on 50 visits of one clinic → numbers 00001..00050, no gap,
no duplicate**; a fault after the number (`tests/helpers/fault.ts`) → the next create still gets the next number (no gap). Fails-without
(High: gaps/duplicates): the count-based generator restored inside a rolled-back transaction → the parallel case shows a duplicate or gap;
recorded, restored. Unit: `money.spec.ts` (paise round trip for every 2-decimal value 0.00..10,000.00 step 0.01 sampled + edge cases,
`₹1,25,000`, `₹499.50`, `−₹50`, parse rejects `1e3`, `1.234`, negatives), `fy.spec.ts` (the same case table the pgTAP file uses, shared JSON).
Lane: baseline `save.R.collect`, `in-app.O.billing-reports` rows re-measured (must not rise).
Done: every new invoice is numbered per FY with no gaps; bad headers impossible; one money formatter.

### 10-02 Sign & Bill from the clinic fee, with the visit version · S-M · migration 000141_sign_and_bill_context

Goal: D-10, D-11 and the two deferred 09E items. Sign & Bill opens with the clinic's fee and refuses a visit that changed.

Files: `supabase/migrations/000141_sign_and_bill_context.sql`; new `supabase/tests/database/sign_and_bill_context.test.sql`;
`features/billing/{service,actions,schema}.ts` (`getSignAndBillContext`); `components/consultation/sign-and-bill-modal.tsx` (no `defaultFee`
literal; the context query on open; `expected_version` sent; `MoneyInput`; fee chips from the context), `components/consultation/workspace/consult-workspace.tsx`
(caller), `components/queue/checkout-drawer.tsx` (fee chips from the clinic fees, dead `defaultFee = 500` removed), `lib/query/keys.ts`;
`tests/security/guard-manifest.ts`; `tests/e2e/consult/sign-and-bill.spec.ts` (new or extended), `tests/e2e/perf/latency-budgets.ts`.

1. Tracer: the read returns `{ fee: {consultation, followup}, methods, visit: {id, row_version, status}, invoice: {id, row_version,
   total, paid} | null }` (INVOKER, `consultations:edit` and own visit, or `billing:collect`); the modal shows the clinic fee (a clinic set to
   ₹650 shows ₹650).
2. The modal sends `expected_version` from the context; `ROW_CHANGED` shows the fixed message, re-reads the context and keeps the doctor's input.
   A null fee (clinic never set one) shows an empty required field, never ₹500.
3. Drawer chips from the clinic fees; `grep -rn "500" components/queue components/consultation` lists no fee literal (recorded in notes).
4. PWA-06b on the modal and the drawer: 15 s client timeout, one retry with the same request id, `SaveStatus` states.

Tests: pgTAP: grants, another clinic NULL, a doctor on another doctor's visit NULL, receptionist without `billing:collect` NULL, shape
allow-list (no PHI fields beyond the ids). Vitest: the action sends `expected_version` (`@ts-expect-error` without it). e2e (three projects):
clinic fee ₹650 → modal shows ₹650 and the bill totals ₹650 after reload (database checked); stale: the desk checks the visit out of the
consult state through the command API between open and submit → "This changed on another device", nothing signed, no invoice
(fails-without, High: lost update: the version dropped from the submit → the stale Sign & Bill signs; recorded, restored); axe on the modal at
three widths. Lane rows: `open.D.sign-and-bill` (1 call, depth 1, `@budget`), `save.D.sign-and-bill` (≤ 2, ≤ 2, B-8).
Done: no ₹500 literal; Sign & Bill refuses a moved visit.

### 10-03 Invoice line commands; locked after payment · M · migration 000142_invoice_item_commands

Goal: D-4, the 09E hand-off. Lines change only through commands that refuse a stale invoice, and never once money was taken.

Files: `supabase/migrations/000142_invoice_item_commands.sql`; new `supabase/tests/database/invoice_item_commands.test.sql`;
`features/billing/{service,actions,schema}.ts` (`addInvoiceItem`, `updateInvoiceItem`, `removeInvoiceItem` on `callCommand`; the direct
writes deleted); `components/queue/checkout-drawer.tsx`; `lib/db/errors.ts` (`INVOICE_LOCKED`); guard manifest; affected specs
(`tests/billing/*`, `tests/integration/per-visit-billing.spec.ts`, `tests/e2e/m0/checkout-collect.spec.ts`).

1. Tracer: `add_invoice_item(p_tenant_id, p_invoice_id, p_item jsonb, p_client_request_id, p_expected_version)` → one line, totals by the
   existing sync trigger, result `{invoice, row_version, versions}`; the drawer's add uses it.
2. `update_invoice_item` (quantity, unit price, description; key immutable as today), `remove_invoice_item`, and `set_invoice_discount`
   (the drawer's discount; caps by CHECK). Each: guard block, replay, lock the invoice, version compare, `INVOICE_LOCKED` when the invoice is
   not `issued` or any payment exists (D-4), audit `invoice.item_*`.
3. `REVOKE INSERT, UPDATE, DELETE ON public.invoice_items FROM authenticated`; drop the now-unused write policies; pgTAP proves the revoke
   and that the integrity trigger still runs for the definer path.
4. Drawer: every line edit and discount through `useConfirmedCommand`, `invoice.row_version` from the query, result applied with `setQueryData`.

Tests: pgTAP per command (happy with audit; stale version refused with no row, audit or signal; replay with a stale version returns the
stored result; `INVOICE_LOCKED` after a partial payment; another clinic `NOT_FOUND`; doctor refused; one signal per transaction). Direct
insert/update/delete by `authenticated` → 42501. Fails-without (High: tampering a paid bill): the grant restored inside a rolled-back
transaction → a direct line insert on a paid invoice succeeds → red; recorded. e2e: two contexts, B adds a line, A's stale remove → refused,
A shows B's line; a partially paid bill shows lines read-only with "Refund or void to change this bill". Lane: `save.R.add-item` (1, 1,
`maxRsc` 0, `@budget`), `save.R.remove-item` (1, 1).
Done: no direct write to `invoice_items` from any request path; `npm run inventory` clean.

### 10-04 Cancel, refund, void · M · migration 000143_cancel_void_refund

Goal: D-3, D-5. Every correction is one audited command with a reason, money out never exceeds money in, and the receipt tells the truth.

Files: `supabase/migrations/000143_cancel_void_refund.sql`; new `supabase/tests/database/cancel_void_refund.test.sql`;
`lib/permissions/matrix.ts` (`billing:refund`: owner, admin) and its parity spec; `features/billing/{service,actions,schema}.ts`
(`cancelInvoice`, `refundPayment`, `voidInvoice`); new `components/billing/invoice-sheet.tsx` (lines, payments, refunds, balance; actions by
permission; reason required; confirm-class pending), opened from the Today row's bill chip and the collections register; `lib/db/errors.ts`
(`INVOICE_HAS_PAYMENTS`, `REFUND_EXCEEDS_PAID`, `INVOICE_NOT_REFUNDABLE`); guard manifest; webhooks `invoice.cancelled`, `invoice.refunded`,
`invoice.voided` added to the outbox catalogue only if the webhook event list is open (else listed as a V2-12 hand-off).

1. Tracer: `cancel_invoice(p_tenant_id, p_invoice_id, p_reason, p_client_request_id, p_expected_version)`: `issued` with net collected 0 →
   `cancelled`, audit with reason; the visit can be billed again (new number; the cancelled one keeps its number).
2. `public.invoice_refunds(id, tenant_id, invoice_id, payment_id NULL, amount CHECK > 0, method CHECK cash|upi|card, reason NOT NULL,
   recorded_by, command_id UNIQUE per tenant, recorded_at)`, composite FKs, RLS SELECT = `billing:view`, no write grants, `billing` version
   trigger. `refund_payment(…, p_amount, p_method, p_reason, …)`: `billing:refund`; Σ refunds + amount ≤ Σ payments (`REFUND_EXCEEDS_PAID`);
   status `paid` → `issued` when a balance reappears (D-2). `void_invoice(…, p_reason, p_method, …)`: refunds the whole net held in one row,
   then `void`. Both lock the invoice, compare the version, audit, outbox.
3. Balance = total − payments + refunds in one SQL expression used by every read (`private.invoice_balance(invoice_id)`), so the desk,
   the register and the receipt agree; `step_record_payment`'s overpayment cap uses it (a refunded bill can be collected again up to its balance).
4. Invoice sheet UI with the three actions; receptionist sees Cancel only (when nothing collected); refund amount ≤ the refundable shown.

Tests: pgTAP: role matrix (owner/admin refund and void; receptionist cancel only; doctor none); over-refund refused; refund then collect
again within the balance; void of a partly refunded bill refunds only the rest; void/cancelled invoices refuse payments and line edits;
cancelled frees the visit, void too; stale version refused; replay; one signal per transaction; 20 parallel refunds of ₹100 on a ₹1,000
paid bill → exactly 10 succeed (Vitest DB, concurrency). Fails-without (High: money out > money in): the cap removed inside a rolled-back
transaction → the parallel refunds exceed the paid total → red; recorded. e2e (three projects): owner refunds ₹200 of ₹650 → balance ₹200,
status Issued, receipt lists the refund; owner voids → VOID on the receipt, the visit shows Bill again; receptionist sees no Refund (UI) and
the action refuses (direct call). Axe on the sheet. Lane: `save.O.refund` (1, 1, `@budget`), `save.R.cancel-invoice` (1, 1).
Done: PO-4 cancel/void/refund complete; edits after payment and over-refunds impossible in SQL.

### 10-05 Collections register, receipt print and share, journey 7 · M · migration 000144_billing_collections

Goal: D-12 to D-14, P1-33 register, P2-10 receipt, PWA-12 share, journey 7.

Files: `supabase/migrations/000144_billing_collections.sql` (`public.billing_collections(p_tenant_id, p_from date, p_to date, p_filters
jsonb, p_cursor jsonb, p_limit int DEFAULT 50)`: INVOKER, `billing:view`, ≤ 92 days, rows of payments and refunds with invoice number,
patient display name, doctor, method, amount, status; `totals` by method (collected, refunded, net) for the whole filter; `next_cursor`;
the `billing` version) and indexes it needs (`payments (tenant_id, recorded_at, id)`, `invoice_refunds` likewise); new
`supabase/tests/database/billing_collections.test.sql`; new `lib/pagination/keyset.ts` (encode/decode, zod) + `lib/pagination/url-filters.ts`;
`app/(dashboard)/billing/collections/{page,loading}.tsx` (new; `/billing/register` redirects here; `/billing/reports` kept as the daily
summary, its reads moved onto the same function); `components/billing/collections-register.tsx` (filters as `FilterChip`s in the URL,
`DataTable` + `Pagination`, CSV of the current filter via existing `csv-utils`, changed-elsewhere notice); `app/api/invoices/[id]/receipt-pdf/route.ts`
and `features/billing/pdf/receipt-document.tsx` (status stamp, refunds, balance, GSTIN when set, "Tax / GST" only when non-zero, doctor name
from the doctor directory, not JWT metadata (A-12), letterhead settings from 09C); new `app/(print)/receipt/[id]/page.tsx` or the
existing receipt modal with `@media print` CSS (A5/A4 from the clinic's paper setting); Web Share of the PDF (09C `share-pdf` helper,
fallback download); new `tests/e2e/journeys/journey-07-billing.spec.ts`; `tests/e2e/billing/collections.spec.ts`; latency rows; guard manifest.

1. Tracer: the register shows today's payments from one call, 50 a page, URL `?from=&to=&method=upi`, a reload keeps the filter.
2. Totals, refunds as negative rows (`−₹200`), cursor next/previous, CSV of the filter (server-side, same function, `private, no-store`).
3. Receipt: print view and PDF agree (golden text test on the PDF, print CSS checked at A5 and A4 via `page.pdf` text), Web Share on
   phones (`navigator.share` with the file when `canShare`), download otherwise; WhatsApp receipt share unchanged.
4. Journey 7 (TEST_STRATEGY §7): doctor Sign & Bill with ₹300 cash of ₹650 → desk collects ₹350 UPI → status Paid → receipt shows both
   payments and ₹0 balance; then owner refunds ₹100 → register net for the day = ₹550.

Tests: pgTAP `billing_collections`: grants, another clinic empty, receptionist with `billing:view` yes, doctor without it empty, the 92-day
cap, cursor stability under inserts between pages (no duplicate, no skip), totals equal the sum of all pages, refunds negative, the version
from the same statement. Fails-without (High: cross-clinic read): the tenant check removed inside a rolled-back transaction → clinic B rows
appear → red; recorded. e2e: journey 7 on three projects (golden on iphone-15), register paging and filters at 360/820/1280 with axe,
receipt print text, share fallback. `command-latency.ts`: `billing_collections` on 10,000 payments + 500 refunds in 30 days, p95 < 100 ms.
Lane: `in-app.O.collections` (B-1: 1 call after the session, depth 1, `@budget`), `full.O.collections`, `in-app.O.collections-next-page`
(1, 1), `open.R.receipt` (1, 1).
Done: register paginated server-side with URL filters; receipt print and share; journey 7 green.

### 10-06 Review fixes · S · migration 000145 only if a fix needs SQL

One isolated reviewer (Sonnet) and one adversarial reviewer (Opus), fresh context, given the phase diff and this plan's DECISIONS only.
Highs and Mediums fixed with a test that fails without the fix; Lows cheap and local or to the backlog with an owner; Highs re-checked once.

### Close

1. Evidence: `npm run stack:recycle`; `node scripts/phase-evidence.mjs .planning/phases/10-billing-collections/evidence 1`; push; CI green with
   0 retried tests; `--ci-run <id>`; copy the `perf-latency` summary and `command-latency.json`.
2. Docs (Haiku): `10-SUMMARY.md`, `10-VERIFICATION.md` (numbers from tool files), `.planning/ROADMAP.md`, master roadmap status line, doc
   amendments (below), VERIFICATION_LOG entry with CI link and SHA, PO-ACTIONS `10-P1..P3`.
3. Gate: approved by the PO or by Claude under the delegated authority, CI run recorded; merge on green.

## Acceptance (roadmap §12 V2-10) → proof

| Criterion | Proof |
|---|---|
| An edit after payment is rejected | pgTAP `invoice_item_commands` `INVOICE_LOCKED` after a partial payment; direct writes 42501; fails-without (10-03) |
| Overpayment is rejected | existing `OVERPAYMENT` cases kept; balance with refunds (10-04) |
| Refund and cancel flows work | pgTAP `cancel_void_refund`; e2e refund/void/cancel; journey 7 refund leg |
| FY numbering has no gaps under 50 parallel creates | `fy-numbering-db.spec.ts` 50-parallel case + fault case; fails-without (10-01) |
| Amounts are formatted en-IN | `money.spec.ts`; ui-policy guard; e2e text `₹1,25,000` / `−₹200` |
| Sign & Bill starts at the clinic fee; refuses a moved visit (09E) | 10-02 e2e (₹650; stale refusal fails-without) |
| No stale line edit / refund | `ROW_CHANGED` cases per command; two-context e2e (10-03) |

## Threat register (STRIDE)

| ID | Cat. | Component | Sev. | Mitigation |
|---|---|---|---|---|
| T-10-01 | T | Direct `invoice_items` writes | high | revoked; commands only; pgTAP 42501; fails-without |
| T-10-02 | T / R | Refund and void (money out) | high | `billing:refund` owner/admin; cap in SQL under the invoice lock; reason + audit; 20-parallel case; fails-without |
| T-10-03 | T | Numbering gaps or burning | high | counter inside the command; no EXECUTE for clients; 50-parallel case |
| T-10-04 | I | `billing_collections`, `sign_and_bill_context` | high | INVOKER, permission, tenant from session, field allow-list; cross-clinic fails-without |
| T-10-05 | T | Lost update on bills | medium | `p_expected_version` on every edit command and Sign & Bill |
| T-10-06 | I | Receipt route / PDF / share | medium | session + permission as today; `private, no-store`; doctor name from the directory (A-12); share uses the PDF bytes only |
| T-10-07 | E | Permission matrix drift | medium | SQL role table and `matrix.ts` parity spec |
| T-10-08 | D | Register range abuse | low | 92-day cap, 50-row pages, keyset index |

## Security-sensitive files (adversarial review list)

`supabase/migrations/000140_billing_invariants_fy.sql`, `000141_sign_and_bill_context.sql`, `000142_invoice_item_commands.sql`,
`000143_cancel_void_refund.sql`, `000144_billing_collections.sql` (and 000145 if any); their pgTAP files; `lib/permissions/matrix.ts`;
`features/billing/{service,actions,schema}.ts`; `app/api/invoices/[id]/receipt-pdf/route.ts`; `features/billing/pdf/receipt-document.tsx`;
`tests/security/guard-manifest.ts`; `lib/db/errors.ts`.

## Doc amendments (applied at the close)

| # | Document | Amendment |
|---|---|---|
| A-1 | DESIGN_SYSTEM §7.7 table | Money storage: UI and `lib/money` in paise; database `NUMERIC(10,2)` with CHECKs (X-1) |
| A-2 | TARGET_ARCHITECTURE §7 command list | add invoice line commands, cancel, refund, void, `sign_and_bill_context`, `billing_collections` |
| A-3 | V2_MASTER_ROADMAP P1-06 | statuses and the refund table as built (D-2, D-3); patient bills carry no GST (D-9) |
| A-4 | VERIFICATION_LOG | D-14 refuted items closed (paid invoices immutable, overpayment and refund caps); X-2 recorded |

## Hand-offs

- V2-11: `lib/pagination/keyset.ts` and the URL-filter helper for every register; the invoice sheet is reachable from the patient profile's billing tab.
- V2-12: webhook events for cancel/refund/void if not added here; the API's billing writes use the same commands.
- V2-13b: `lib/fy` for SaaS invoices (SUB-05).
- V2-13 (DPDP): billing retention C28 (6 vs 8 years) unchanged here.

## PO external actions

- `10-P1`: none blocking. After merge: staging migrate of 000140-000144 (not delegated), then a 10-minute walkthrough (Sign & Bill with a
  partial payment, collect the balance, refund, void, print and share a receipt, the register on a phone).
- `10-P2`: set each staging clinic's consultation and follow-up fee in Settings (Sign & Bill no longer defaults to ₹500).
- `10-P3`: confirm with a CA that clinic consultation receipts need no GST lines (D-9); answer only if the CA disagrees.

## Out of scope

Patient payment gateway (PO-4); per-doctor fees; GST computation on products (v2.1 inventory); credit notes as separate documents
(refund rows serve); branch-level numbering (v2.1; numbering stays per clinic, V2-07 R-5); SaaS invoices (V2-13b).

## Execution (lean process; deadline 6 Dec)

- One Opus executor, plans in order, about one day for the phase; `npm run stack:recycle` between plans. Never set a mode when starting a subagent.
- Affected tests only per plan; the full PR lane once after 10-05; CI runs everything; one evidence run.
- Reviews: Sonnet isolated, Opus adversarial, one fix round; docs by Haiku.
- Branch `v2/phase-10-billing-collections` off `feature/v2` at c609907a or later; never `main`; no force-push; local stack only.
