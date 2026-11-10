# clinicOS v2.0: SaaS Subscriptions, Plans, Entitlements and Tenant Data Lifecycle

**Status:** Design proposal (planning only), revision 2 after independent review. **Author:** subscriptions track lead (Claude). **Date:** 2026-11-10.
**Scope:** new PO requirement #2 (plans, pricing, AutoPay subscription, trial, cancellation, expiry, archive, purge, admin portal) and the entitlement mechanism that requirement #1 (AI gating) depends on.
**Related docs:** `V2_MASTER_ROADMAP.md` (backlog, phases, gates), `TARGET_ARCHITECTURE.md` §3.6 and §8 (jobs), `DATA_HANDLING.md` §5 (retention), `SECURITY_ASSESSMENT.md` SEC-05 (share links) and SEC-26 (MFA), `AI_STRATEGY.md` (**owns the AI feature keys, AI pricing decision D-1 and trial decision D-2**), `AUTH_REDESIGN.md` (signup, onboarding routes, MFA), `PWA_STRATEGY.md` §6.6 (AutoPay in an installed PWA).

Labels: **Fact**, **Problem**, **Risk**, **Assumption (validate)**, **Recommendation**, **Open question**, **Deviation (PO to accept)** (where this design adds something the PO did not ask for, or softens something the PO did ask for). Priorities P0–P3. Sizes S/M/L/XL only. External facts were checked on 2026-11-10 and are cited in §15; anything not confirmed is marked **Unconfirmed**.

---

## 0. Summary

> Update (2026-11-10, PO round-3 decision; coordinator rulings R1, R2, R4). **These override anything below that disagrees, including the round-2 banner.**
> - **Coupons and UAT refunds are in v2.0 (new §14).** Free time (free cycles, trial extension, UAT codes) defers the Razorpay `start_at`, so the mandate is still authorised at signup with the ₹5 token and no ₹0 debit is ever attempted (Razorpay offers need a chargeable amount above ₹1). Percentage and fixed discounts use a Razorpay **flat offer** linked at subscription creation, computed by us on the GST-exclusive base; our `saas_invoices` show the discount line and charge GST on the discounted taxable value. One coupon per subscription, no stacking. Refunds become an audited, idempotent platform RPC with GST credit notes. Backlog **SUB-COUPON-01…08** (about L); PO items SUB-D9…D11 (§14.12).
> - **Free tiers apply only to the real-world UAT stage (R2), not to the first months after paid launch.** The PO-17 bullet below now reads "while on Supabase Free during UAT"; the Supabase Pro (+ PITR) upgrade is a paid-launch exit criterion. UAT testers get **`uat` coupons rather than charge-and-refund** (§14.8). Vercel hosting is handled by the PO (R1); this doc has no Vercel plan dependency beyond the export-job function limits (§6.5).
> - **Roadmap placement (addendum 4):** the UAT stage is roadmap phase **V2-16** (between gate **G6, UAT start** and gate **G7, paid launch**); SUB-COUPON-01/02/03/04/05/07 are in V2-13b, -06 in V2-13c, -08 in V2-15/V2-16 (roadmap §10.2, C47). The Supabase upgrade timing is roadmap PO-26 (default at UAT exit).
> - **AI preview consent (R4):** the owner opt-in for the AI preview stays (data goes to Google; DPDP consent and trust), the 1,500-draft quota itself is silent (no meter, no upsell).

> Update (2026-11-10, PO round-2 decisions; roadmap PO-17, PO-20, PO-21, PO-25, C41, C44; VERIFICATION_LOG addendum 3). **These override anything below that disagrees.**
> - **GST-exclusive price (PO-20 ✅, C44).** "1499 excluding GST not including." Standard is **₹1,499.00 + 18% GST**: CGST ₹134.91 + SGST ₹134.91 (same state as the supplier) or IGST ₹269.82, so the debit is **₹1,768.82/month** and the Razorpay plan amount is **176882 paise** (Razorpay charges the plan amount as given; confirm in test mode that nothing is added). Every price label reads **"₹1,499 + GST"**; checkout, the trial-end notices and the pre-debit email state the ₹1,768.82 debit. `plan_prices` stores `base_amount_paise`, `tax_rate_bp` and `tax_inclusive = false`, and the charge amount is derived (§7.1). GST can be charged only with a GSTIN, so **registration before go-live is a go-live blocker**. SUB-D1 is settled.
> - **No purchasable AI in v2.0 (PO-21 ✅, C41).** The AI Assist add-on and its second Razorpay subscription (**SUB-11**) are **deferred until the AI Voice Receptionist launch**; `tenant_addons` is deferred with it. Plan and billing pages show AI as **"Coming soon"** (no price, no buy button). The trial (`standard_trial`) still grants `ai.scribe` with a **1,500-draft trial quota**, shown as **"Preview"** with the note "AI features are in preview and not yet offered as a paid product". Post-trial default (PO-25): preview access ends with the trial. §7.4's second-subscription design is kept as the reference for future flat-fee add-ons. SUB-D8 is closed as deferred.
> - **Configurable catalogue.** `plans` becomes a product catalogue (`kind`, `purchasable`, `visibility`) and `plan_prices` carries a `billing_model` so very different future prices (per-minute or usage-based voice receptionist, flat add-ons, included units + overage) fit without schema changes; a backend switch (`platform.set_product_availability`, SQL now, Plans & prices screen in V2-13c) makes a product purchasable once its purchase flow ships (§7.1, §8.1).
> - **Free tiers (PO-17 ✅; scoped by round 3 / R2 to the UAT stage only).** Supabase Free during UAT (originally "the first 2–3 months after go-live"): no PITR, so §6.4's "restore" relies on the self-run dumps (roadmap FT-02), and purges take an on-demand dump first. Archives can fall due inside the window (from about day 44); **purges cannot** (expiry + 180 days). While on Free, archive also takes an on-demand FT-02 dump first, as purges do (archive deletes derived data irreversibly). Export bundles count against the 1 GB Free Storage quota, so FT-04 includes export-bucket bytes, or the archive export goes to the S3 `ap-south-1` bucket while on Free.

> Update (2026-11-10, PO decisions): Roadmap reconciliation (V2_MASTER_ROADMAP §10.3):
> - **C33:** AI Assist is a second Razorpay subscription with plan code `ai_assist` (SUB-D8 (a)). AI_STRATEGY's `ai_pro` plan is not used. Price and quota follow AI D-1 (placeholder about ₹499 and about 1,500 pooled drafts, set by SQL). **Superseded by C41 (round 2): no AI is sold in v2.0.**
> - **C34:** the trial AI quota equals the AI Assist monthly quota (AI D-2, "no restrictions at all"), not 100 drafts. It is still a configurable `plan_entitlements` value.
> - **C35:** feature-key names follow AI_STRATEGY §6.2 (`assist.terminology`, `ai.operations_copilot`, …), not `assist.smart.*` / `ai.copilot.*`.
> - **Phases (C36):** V2-13b and V2-13c are adopted as written here.
> - **Final review (C39, C40):** the body of this document is now reconciled (not only this banner): keys, trial quota, webhook route, admin Plans & prices screen (SUB-09, v2.0) and the sequential phase order.
> - **PO items:** SUB-D1 becomes roadmap PO-20, SUB-D8 becomes PO-21, and SUB-D2–D7 are bundled in PO-23. All have the defaults given here.

- **Recommendation:** use **Razorpay Subscriptions** for UPI AutoPay and card mandates. Each clinic gets a subscription whose `start_at` is the end of the trial, so the mandate is authorised at signup with a refundable ₹5 token charge and the first debit of ₹1,768.82 (₹1,499 + 18% GST) runs on day 15. Cashfree is the fallback, kept behind a thin `BillingProvider` interface.
- **Recommendation:** **clinicOS's own database is the source of truth for access.** The provider is the source of truth for money. Access is computed from timestamps (`access_ends_at`) in SQL, so a missed job or webhook can never extend access. The hard stop at expiry is enforced in the database (table RLS **and storage policies**), the server guard and the layout.
- **Recommendation:** use a lifecycle of `incomplete → trialing → active ⇄ past_due → expired (locked, 30 days) → archived → purged (expiry + 180 days)`. Cancellation is a flag (`cancel_at_period_end`), not a state. A full data export is offered to the clinic (the data fiduciary) before the archive and again before the purge, **only through the signed-in billing page**, never as a link in email or WhatsApp.
- **Recommendation:** in v2.0, **"archive" is a logical lock plus an export snapshot** in a private, India-region bucket (platform encryption at rest; see §6.5), not a physical move of rows. Moving rows saves almost nothing (§6.4), while a move-and-restore pipeline is the riskiest code a one-person team could write. Restore is instant and lossless. The purge hard-deletes the clinic's data and files; the platform's own statutory records (GST invoices, audit and security logs) survive for their legal periods (§6.6).
- **Recommendation:** use **plan, price, entitlement-key and plan-entitlement tables**, configured by SQL first and through an admin UI later, with `has_entitlement()` in SQL. The **trial** grants Standard plus the AI scribe as a labelled **Preview** with a 1,500-draft trial quota (PO-21). After the trial, LLM features (`ai.*`) are off by default (PO-25); **no AI add-on is sold in v2.0**, and future AI products are enabled from the backend. Deterministic **Smart Assist** features (`assist.*`, keys owned by `AI_STRATEGY.md` §6.2) stay in Standard.
- **Fact (verified):** Razorpay subscriptions authorised via UPI or eMandate **cannot be updated**, and add-ons cannot be created on UPI-authorised subscriptions. A future flat-fee AI add-on would therefore be billed as a **second Razorpay subscription with its own mandate** (§7.4; deferred, C41).
- **Recommendation:** build the **platform admin portal inside the same Next.js app** (`/platform/**`), with a `platform_admins` table separate from tenant roles, mandatory TOTP MFA (aal2), SECURITY DEFINER RPCs and an append-only audit log. No access to clinical data.
- The work is a new track, **SUB-01 … SUB-11**, about **XL** overall. SUB-01/02 go into **V2-05**; the rest goes into two new phases, **V2-13b** (billing) and **V2-13c** (admin and data lifecycle), placed **after V2-11/V2-12/V2-13 and before V2-14**, so every dependency already exists and V2-14 verifies it. See §13.

---

## 1. Requirements restated (precise)

### 1.1 Settled by the PO (2026-11-10)

| # | Requirement | Notes / interpretation |
|---|---|---|
| R1 | One **Standard plan at ₹1,499 per month**, per clinic (tenant), billed by an automatic recurring debit (subscription). | "Per clinic" = per `tenants` row. **GST-exclusive (PO-20 ✅):** ₹1,499 + 18% GST = ₹1,768.82 debited. |
| R2 | The price and plan parameters can be **configured by a platform admin**; first through SQL on database rows, later through an admin UI. | §8 |
| R3 | Every clinic gets a **14-day free trial with "no restrictions at all"**. | **Trial = Standard + `ai.scribe` as a "Preview", with a trial quota of 1,500 drafts (`ai.scribe.monthly_drafts` on `standard_trial`; PO-21 round 2, superseding C34), and owner opt-in still required.** The quota is a cost guard equal to what a paying clinic gets, so the trial is never more restricted than the paid product. |
| R4 | **Settled.** "When they sign up they setup the AutoPay mandate either via UPI or Cards and automatically on 15th day the amount is debited." | The mandate is **required** to start the trial. §5. (This resolves `AUTH_REDESIGN.md:127` "Open question SUB": the mandate step blocks dashboard access until authorised.) |
| R5 | The clinic can **cancel at any time**, during the trial or after paying. The mandate stops further debits. Access continues **until the end of the current paid period** (cancel on the 20th with a 15th anchor → access until the next 15th), then stops **"automatically and forcefully … as soon as the plan expires"**. No pro-rata refund. | §6. No grace or buffer ever applies after a cancellation. |
| R6 | On expiry, data is **retained for 1 month**. Any login is **redirected to billing**. | `expired` (locked) state |
| R7 | After that month the data is **moved to archive**. On re-purchase it is **restored**. | `archived` state; logical archive (§6.4) |
| R8 | **Clinic data is never kept more than 180 days** after expiry (cost). | Purge at expiry + 180 days. **The platform's own statutory records are exempt** (GST 72 months, logs 1 year; §6.6). |
| R9 | **AI features are gated.** The base plan does not include real (LLM) AI features but keeps "synthetic AI": deterministic, code-based assists. | §7.3; keys owned by `AI_STRATEGY.md` |
| R10 | Team = PO + Claude. No human reviewer, Claude Code only, no legal counsel. v1 is not live; production is a **new** Supabase project; **go-live only after all of v2 is finished** (PO-15). | No v1 tenants to migrate; no dual paths or flags needed |
| R11 | Hosting stays on **Vercel + Supabase**; data stays in India (PO-6/7, PO-12). | Supabase Mumbai (`ap-south-1`); exports in the same region |
| R12 | PWA, not native apps; "Add to Home Screen" must work seamlessly on phones and tablets (requirement #5). | Mandate checkout must work inside an installed PWA (§5.4) |

### 1.2 Derived requirements (Recommendation)

- **DR1.** The **SaaS tax invoice** to the clinic is separate from the clinic's own per-visit billing (`invoices`, `invoice_items` and `payments` in `supabase/migrations/000009_billing_invoicing_payments.sql:12,29,42`). It uses its own Indian financial-year numbering series, consistent with PO-4.
- **DR2.** Enforcement is **server-side and in the database**. The UI only reflects state and is never the control.
- **DR3.** Every state transition writes an **append-only event** with its actor (system, provider, owner or platform admin) and reason.
- **DR4.** The clinic is the **data fiduciary** for its medical records. Before the archive and before the purge, clinicOS offers and announces a **full export** (§6.5).
- **DR5.** **Idempotent, signature-verified webhooks** and a **reconciliation job**. Provider state and local state cannot silently diverge.
- **DR6.** **IST** business boundaries for billing (§10).
- **DR7.** The owner journey is self-serve end to end: start trial, see the next debit date and amount, change the payment method, cancel, resume before the period ends, download invoices, export data and re-purchase. Routine operations must not need the PO.

All open items are collected in **§12 (SUB-D1 … SUB-D8)**. AI pricing and the AI trial are decided in `AI_STRATEGY.md` (D-1, D-2) and are cross-referenced, not re-decided, here.

---

## 2. Current state in the repository (evidence)

- **Fact:** a v1 `subscriptions` table exists with `plan TEXT DEFAULT 'standard'`, `amount_inr INTEGER DEFAULT 1000`, status `active|past_due|canceled|trialing` and `current_period_end DEFAULT now()+30 days` (`supabase/migrations/000002_invitations_billing.sql:29-38`). `payment_records` has no provider IDs and no tax fields (`:43-51`). The RLS policies allow only owner/admin SELECT. No insert or update paths exist (`:91-118`).
- **Fact:** `features/billing/subscription.ts:12-46` only reads these tables. `app/(dashboard)/settings/billing/page.tsx:1-83` renders them. `PRODUCT_BASELINE.md:48` records "Not implemented: nothing creates subscription rows; no payment gateway; no trial or expiry enforcement". The page is orphaned (`PRODUCT_BASELINE.md:52,84`).
- **Fact:** tests touch these tables. See `tests/security/cross-tenant.spec.ts:61-73` and `tests/integration/subscription.spec.ts:15-32` (the latter seeds `amount_inr: 1000`).
- **Fact:** there is no `razorpay`, `cashfree`, `entitlement`, `plan_features` or platform-admin code anywhere in `app/`, `features/`, `lib/` or `supabase/migrations/`, based on a grep on 2026-11-10.
- **Fact (where to enforce):**
  - `middleware.ts:49-52` only refreshes the Supabase session, and `/api/v1`, `/api/health` and `/api/ready` bypass it (`:6-12`).
  - Tenant resolution happens in `lib/auth/tenant.ts:30-80` (`getActiveMembership`).
  - Server actions are guarded by `requirePermission` (`lib/permissions/guards.ts:16-28`).
  - The dashboard shell resolves membership and redirects in `app/(dashboard)/layout.tsx:22-29`.
  - RLS uses `public.current_user_tenant_ids()` (`supabase/migrations/000001_foundation.sql:32`).
  - Clinic creation is the atomic RPC `create_clinic_with_owner` (`000001_foundation.sql:78-109`).
  - Storage paths start with the tenant UUID (`features/prescriptions/pdf/generator.ts:91`, `features/labs/actions.ts:102`), and public share links resolve through `document_share_tokens` (`app/api/r/[token]/route.ts:220-235`; SEC-05).
- **Fact (AI entry points):** the inventory and the target keys are owned by `AI_STRATEGY.md` §1.1, §5.2 and §6. In summary: the SOAP scribe (`features/ai/actions.ts:21`) becomes paid `ai.scribe`; the LLM catch-up summary (`:47`) is replaced by deterministic `assist.snapshot`; both copilots (`app/api/ai/clinical-copilot/route.ts`, `app/api/ai/operations-copilot/route.ts`) are removed in v2.0; frequent prescriptions (`:72`) and ICD suggestions (`:103`, deterministic, ICD-11) become `assist.frequent_rx` and `assist.terminology` (AI §6.2).
- **Problem:** the v1 schema cannot express a trial, a mandate, a cancellation at period end, grace, archive or purge dates, a price history, provider IDs, GST, add-ons or entitlements. **Recommendation:** drop and replace it. v1 is not live (R10), so no data migration is needed. Update the two tests above.

---

## 3. Payment provider evaluation (Indian recurring payments)

### 3.1 Regulatory facts that constrain the design

| Topic | Fact (source) | Design consequence |
|---|---|---|
| RBI e-mandate framework | RBI consolidated the e-mandate rules as the *Digital Payments – E-mandate Framework, 2026* (issued 21 Apr 2026). Recurring debits **up to ₹15,000 per transaction** run **without an additional factor of authentication (AFA)**; above that, AFA is needed for each debit. The **first transaction** and any **modification or withdrawal** need AFA; the issuer sends a pre-debit alert ≥ 24 h before the debit. [S1][S2][S3][S24] (KPMG corroborates first-transaction AFA and the 24 h alert; it does not restate the ₹15,000 figure. The circular text itself was **not retrieved**.) | ₹1,768.82 (₹1,499 + GST) is well under ₹15,000, so renewals are frictionless. **An annual plan priced above ₹15,000 would need AFA on every debit**, which caps any future annual price, or means collecting it as a one-time payment instead. |
| Pre-debit notice | The **issuer** must send a pre-transaction notification **≥ 24 h before** the debit, with merchant, amount, date/time, mandate reference and reason, plus a post-debit notice. [S1][S3][S24] | Sent by the bank/UPI app through the provider rails, not by us. **Recommendation:** we also send our own "trial ends in 3 days / tomorrow, ₹1,768.82 (₹1,499 + GST) will be debited on <date>" email, which reduces disputes and revocations. |
| UPI AutoPay limits | ₹15,000 without AFA for general categories. Razorpay documents UPI AutoPay mandate creation up to ₹1,00,000 [S5][S6]. | No impact at ₹1,768.82 |
| UPI Collect deprecation | UPI Collect is deprecated for **new UPI AutoPay registrations from 28 Feb 2026**; use the **UPI Intent** or QR flows [S5]. | Use the provider's in-page checkout (Intent on mobile, QR on desktop). Never build a VPA-entry collect flow. |
| Customer revocation | Customers can **pause or revoke** UPI AutoPay mandates from their UPI app at any time (except loan/EMI categories) [S9][S10]. Merchants must not delete a mandate that the user has paused [S9]. | A revocation is an **external cancellation**. Handle it like `cancel_at_period_end` (§6). It is detected by webhook or by reconciliation. **Unconfirmed:** which Razorpay webhook fires on an app-side revoke; reconciliation covers this. |
| Card tokenisation | Merchants cannot store card data. Recurring card debits use network or issuer tokens (CoF tokenisation) [S11]. | We store only the provider token/mandate ID, card network and last 4. No PCI scope beyond SAQ-A, because Razorpay's hosted checkout is used. |
| Mandate immutability (Razorpay) | **Fact:** "subscriptions cannot be updated when payment mode is UPI"; "Emandate subscriptions are immutable post-authentication"; card subscriptions have no stated restriction [S25]. Creating an add-on on a UPI-authorised subscription fails with a 400 error, and an add-on is a **one-time** charge on the next invoice, not a recurring one [S26]. | Any price or plan change for a UPI clinic means **cancel + create a new subscription**, which needs a new mandate authorisation with AFA (§8.2). The AI add-on cannot be an add-on line on the base subscription (§7.4). |
| Mandate validity | **Unconfirmed**: no clear NPCI maximum validity was found [S9]. | `total_count` is set high (§5.1); revisit if Razorpay caps it. |
| Off-peak execution | Reports say NPCI moves recurring UPI debits to off-peak windows in 2026 [S23]. **Unconfirmed** (secondary press source; no NPCI circular found). | Never lock at the exact anchor minute; see the pending-charge buffer (§6.2). |

### 3.2 Options

| Criterion | **Razorpay Subscriptions** | Cashfree Subscriptions | PhonePe PG AutoPay | Paytm PG | Stripe India |
|---|---|---|---|---|---|
| Availability for a new Indian business | Self-serve KYC | Self-serve KYC | Self-serve KYC | Self-serve KYC | **Invite-only for new Indian sign-ups since May 2024**; still restricted per 2026 reporting [S12][S13]. **Rejected.** |
| Rails | UPI AutoPay, cards, eNACH [S4][S5] | UPI AutoPay, cards, eNACH [S7][S8] | UPI AutoPay, eNACH, cards [S14] | UPI AutoPay, cards (not evaluated in depth) | — |
| Subscription object (plans, cycles, trial) | Yes: `plans`, `subscriptions`; trial via a **future `start_at`**, with a ₹5 token authorisation that is auto-refunded [S4] | Yes: plans and subscriptions [S7] | Mostly merchant-driven: the merchant triggers each recurring debit and is called back [S14] | — | — |
| Cancel at period end | `cancel_at_cycle_end=true`, not allowed before the first cycle; cancelled subscriptions cannot be restarted [S15] | Supported (**Unconfirmed** detail) | Merchant-managed | — | — |
| Retries / dunning | **Cards and UPI: on failure the subscription goes to `pending` and is retried on T+1, T+2 and T+3; if all fail it goes to `halted`** [S16]. eMandate retries wait for the previous result (can exceed 24 h). | Built in (**Unconfirmed** detail) | "Automated dunning" (marketing claim) [S14] | — | — |
| Webhooks | 10 `subscription.*` events plus payment and invoice events. HMAC-SHA256 in `X-Razorpay-Signature`; **`x-razorpay-event-id` for dedupe** [S17][S18] | Yes (signature scheme not reviewed) | S2S callbacks | — | — |
| Sandbox | Test mode with test keys, test cards and test UPI IDs [S19] | Sandbox | Sandbox base URL [S14] | Sandbox | — |
| Fees (indicative) | ~2% gateway + a subscription add-on reported as **0.9%–0.99%**, + 18% GST on fees; no setup fee. **Unconfirmed**: sources conflict [S20]. About ₹60–65 per ₹1,768.82 debit. | UPI AutoPay: **₹7.5 per mandate + ₹15 per presentation ≥ ₹1,000** (+GST) from a Cashfree blog; card mandate pricing not found. **Unconfirmed** [S8]. About ₹18 per debit on UPI. | Not found | Not found | — |
| Developer familiarity (matters for a Claude-only team) | Very high: the most widely documented Indian subscription API | High | Medium | Medium | — |

### 3.3 Recommendation

**Recommendation (P1): Razorpay Subscriptions**, accessed through a thin internal interface `lib/billing/provider.ts`. The interface methods are `createSubscription`, `cancel(atCycleEnd)`, `fetchSubscription`, `fetchInvoices`, `verifyWebhook`, `verifyCheckoutSignature` and `refund`. Razorpay is the only `BillingProvider` implementation in v2.0, alongside a `FakeBillingProvider` for tests.

Reasons:
- Razorpay's native trial semantics (future `start_at` with an auto-refunded ₹5 token authorisation) map one-to-one onto R3/R4.
- It provides `cancel_at_cycle_end`, which maps onto R5.
- Its built-in T+1/T+2/T+3 retries and `halted` state map onto dunning.
- Its webhooks carry an event ID for idempotency.
- It has a mature test mode and the lowest integration risk for a team with no human engineers.

**Trade-offs:**
- Razorpay's percentage fee is about 3× Cashfree's flat UPI fee at this price point: roughly ₹35 more per clinic per month, or about ₹3,500/month at 100 clinics (**Unconfirmed** figures).
- Razorpay's immutability of UPI subscriptions forces the two-subscription add-on design (§7.4). **Assumption (validate):** Cashfree has a comparable limitation; not researched.
- **Recommendation:** ask both providers for a quote during KYC. If Cashfree's card-mandate support and webhooks check out and the saving matters, switch providers before SUB-03 starts, at **M** cost thanks to the interface. Do not build multi-provider support.
- **Recommendation:** create subscriptions with Razorpay's `customer_notify` set to `false` (**Assumption (validate)** in test mode that it suppresses Razorpay's own customer emails), so clinics do not receive a Razorpay invoice that looks like a second tax invoice beside `saas_invoices`. If it cannot be suppressed, the Terms and the billing page say which document is the tax invoice.

**Prerequisites (P1, PO action, long lead time):**
- A legal entity (or proprietorship) with a PAN and a current account.
- GST details supplied by the PO (SUB-D1).
- A public website with **Terms, Privacy Policy, Refund & Cancellation Policy, Pricing and Contact pages**. Gateways check these at activation. **Assumption (validate)** with Razorpay's KYC checklist. This is backlog item SUB-10.

---

## 4. Subscription model and pricing semantics

- **Configurable defaults (stored in data, not code):** the trial length (14 days), the base price (₹1,499, GST-exclusive), the GST rate (18 %) and `tax_inclusive = false` (PO-20), the AI trial quota (1,500 drafts, PO-21), product availability (`purchasable`, `visibility`), the grace periods (4 and 7 days), the pending-charge buffer (24 h), the lock window (30 days) and the purge horizon (180 days). These live on `plans`, `plan_prices`, `plan_entitlements` and a single-row `platform_settings` table, so the PO can change them with SQL (R2).
- **Money** is stored as **integer paise**. The currency is always `INR`.
- **GST:**
  - **Pricing is GST-exclusive (PO-20 ✅).** The base amount is ₹1,499.00 and GST is added on top: 9 % + 9 % = ₹134.91 + ₹134.91, or 18 % IGST = ₹269.82; both give a ₹1,768.82 charge, so one Razorpay plan amount (176882 paise) serves every place of supply. Tax is computed per line in paise and rounded half-up to the paisa; the invoice total must equal the debit.
  - **No GST without a GSTIN.** Until the PO's GSTIN exists, no GST may be charged, so live billing cannot start before registration (paid-launch blocker, roadmap G7; UAT on `uat` codes debits nothing and needs no GSTIN, §14.8).
  - **A GST-rate change** needs a new `plan_prices` row and therefore a new Razorpay plan and a re-mandate (§8.2), because Razorpay plans and UPI/eMandate subscriptions cannot be updated.
  - Rate 18% for SaaS (**Fact**, widely reported [S21]).
  - Place of supply = the clinic's state on its billing profile. Same state as the supplier → CGST 9% + SGST 9%; otherwise IGST 18%.
  - Record the buyer's GSTIN if the clinic has one (validated by format and checksum only; no GSTN API in v2.0).
  - **PO-supplied facts:** whether the business is GST-registered, its GSTIN, legal name and state (`platform_settings.supplier_gstin`, `supplier_state`). Claude cannot know these.
  - **Claude-researched defaults (Unconfirmed, configurable):** SAC **998314** ("IT design and development services"/online software provision family) as the default setting; sources conflict between 998314, 998315 and 997331 [S21]. Inter-state supply of services: a supplier making inter-state taxable supplies is generally required to register regardless of turnover, with exemptions for some service providers below the threshold; sources conflict [S21], so the default is **"register before paid launch (G7)"** (UAT has no debits, §14.8). Both are settings, not code; professional tax advice is **optional**, not a process step.
- **Billing anchor (worked example used throughout):**
  - The trial starts when the mandate is authenticated (T0, IST). Example: **T0 = 10 Nov 2026, 15:20 IST**.
  - The first debit is scheduled at `start_at = (IST date of T0 + 14 days) 10:00 IST` → **24 Nov 2026, 10:00 IST**. That is "day 15", counting the signup day as day 1, with no midnight edge cases. `trial_end = start_at`.
  - Later renewals follow the provider's monthly cycle from that anchor (24 Dec, 24 Jan, …).
  - The rails may execute the debit hours after the anchor ([S23], Unconfirmed), so access never locks at the exact anchor minute while a charge is in flight (§6.2).
- **No proration and no refunds on cancellation (R5).** Exceptions are handled by the platform admin through the provider's refund API or dashboard: a double debit, or a debit that raced a cancellation.
- **One trial per clinic, and one trial per owner account.** **Deviation (PO to accept), SUB-D5:** the PO asked for a trial for "each clinic"; limiting a repeat owner to one trial is an addition.
  - A repeat signup by the same owner starts with an immediate charge, no trial. The platform admin can override this.
  - **Risk (low):** determined abuse through new email addresses is accepted at this price.

---

## 5. Trial-with-mandate mechanics

### 5.1 Signup and onboarding flow (Recommendation)

Route names follow `AUTH_REDESIGN.md` §3.1 (`/onboarding/clinic`, `/onboarding/billing`; onboarding resumes at the first incomplete step on every login). The flow builds on password-based authentication (requirement #3, owned by the authentication track):

1. **Sign up:** email + password, then an **email OTP** typed in the app to verify the address (`AUTH_REDESIGN.md`).
2. **Create the clinic** (`/onboarding/clinic`): a modified `create_clinic_with_owner` (`000001_foundation.sql:78`) also inserts `tenant_subscriptions(status='incomplete')` and a default `billing_profiles` row **in the same transaction**.
3. **Billing profile** (`/onboarding/billing`, step 1): legal name, state (required, for GST place of supply), an optional GSTIN and a billing email. Server command in `features/subscriptions/commands.ts`.
4. **Start free trial** (`/onboarding/billing`, step 2):
   - The server calls `createSubscription(plan_price.provider_plan_id, start_at = trial_end, total_count = 120, customer_notify = false, notes = {tenant_id})` and stores `provider_subscription_id`. A total count of 120 means 10 years, effectively open-ended. **Assumption (validate):** the maximum `total_count` for UPI mandates.
   - Razorpay Checkout opens **as an in-page modal** with the `subscription_id` (§5.4). The owner picks UPI AutoPay (Intent or QR) or a card, approves with the UPI PIN or card OTP (AFA on the first transaction), and pays the **₹5 token charge, which is auto-refunded** [S4].
   - The checkout success handler verifies the payment signature **server-side**. Only then does it move the tenant to `trialing` (`trial_start = T0`, `trial_end = start_at`).
   - The `subscription.authenticated` webhook confirms the same transition idempotently.
5. **App unlocked.** The billing page shows "Free trial until 24 Nov, then ₹1,499 + GST (₹1,768.82) per month via UPI AutoPay (…@okhdfc). Cancel anytime."

If the owner closes checkout without authorising, the tenant stays `incomplete` and the app shows only `/onboarding/billing`. A `subscriptions.expire_unauthenticated` job cancels any provider subscription left in `created` for more than 60 minutes. A fresh one is created on the next attempt, so `start_at` is always computed from the real authorisation time.

### 5.2 Why the mandate is required (rationale for the settled R4)

The PO settled this (R4). The comparison is kept only as rationale:

| Option | Pros | Cons |
|---|---|---|
| **A. Mandate required (PO's flow, adopted)** | Conversion on day 15 is automatic. Every trial clinic is a verified payer, so fewer junk tenants. One code path. | Signup friction. |
| B. Trial without a mandate, hard stop on day 15 unless they subscribe | Lower friction | A second checkout path, more reminders, a worse day-15 experience. |

Mitigations for the friction:
- Explain on the trial screen: "₹5 is verified and refunded; nothing is charged before <date>; cancel anytime in one tap".
- Send a reminder email 3 days and 1 day before the first debit.
- Let staff invites work only after `trialing`.

`incomplete` tenants hold no clinical data, because the app is unusable before the trial starts. They are deleted after 7 days.

### 5.3 Trial edge cases

- **Cancel during the trial.** Razorpay rejects `cancel_at_cycle_end` before the first cycle [S15]. We therefore **cancel the provider subscription immediately**, which revokes the mandate, and keep **local access until `trial_end` exactly** (no buffer, because no charge is pending), then go to `expired`. The UI says "Your trial continues until 24 Nov, 10:00 AM; you will not be charged".
- **Resume after a cancel during the trial.** The provider subscription cannot be restarted [S15]. "Resume" creates a new subscription with `start_at = trial_end` and a new authorisation. This is the same code path as re-purchase.
- **Mandate revoked from the UPI app during the trial.** Detected by webhook or by reconciliation, and treated as a cancellation during the trial.
- **First debit fails on day 15.** → `past_due`. Razorpay retries on T+1, T+2 and T+3 [S16]. Access continues until the earlier of **provider `halted`** or `grace_until = failed_at + 4 days` (the first-charge grace, §6.2), so the last retry result arrives before the lock. The owner gets an in-app "update payment method" path (a new subscription and mandate, §8.2).

### 5.4 Mandate checkout inside an installed PWA (R12; `PWA_STRATEGY.md` §6.6, Risk P1)

- **Recommendation (P1):** use **Razorpay Standard Checkout as an in-page modal** (`new Razorpay(options).open()` with a `handler` callback). **No `callback_url` / `redirect: true`**, so the page never navigates away from the app's scope.
- **UPI Intent hand-off:**
  - **Android (Chrome, installed PWA):** the Intent button opens the chosen UPI app; on approval the user returns to the PWA task, where the checkout modal is still open and receives the result. **Assumption (validate)** on a device.
  - **iOS (Safari, Home Screen app):** **Unconfirmed** whether UPI Intent deep links from a standalone web app reliably open the UPI app and return to the standalone app rather than Safari. Fallback offered in the modal: card mandate, or UPI QR scanned from a second device.
- **Server-side recovery (stateless return):** whatever the client sees, the server is the authority.
  - The `subscription.authenticated` webhook moves the tenant to `trialing`.
  - On every load of `/onboarding/billing` (and on the next login) while `incomplete` with a stored `provider_subscription_id`, the server calls `fetchSubscription`. If the state is `authenticated`, it applies T1. If the user finished checkout in Safari, the installed app picks it up on the next open.
  - The page polls a status endpoint every 3 s for 2 minutes after the modal closes without a result, then shows "We're confirming your AutoPay; this page updates automatically".
- **Device tests:** §11 adds a manual checklist on an installed Android PWA and an installed iOS PWA (phone and tablet): mandate via UPI Intent, via card, interrupted checkout recovered on next open.

---

## 6. Subscription lifecycle

### 6.1 States (stored in `tenant_subscriptions.status`)

| State | Access level | Meaning |
|---|---|---|
| `incomplete` | `onboarding`: `/onboarding/billing` only | The clinic exists; no authenticated mandate |
| `trialing` | `full` (Standard + `ai.*` under the trial quota, owner opt-in) | Mandate authenticated; `now < access_ends_at` |
| `active` | `full` | Paid; `now < access_ends_at` |
| `past_due` | `full`, with a persistent banner | A debit failed; `now < grace_until` and the provider has not reported `halted` |
| `expired` | `locked`: billing, export and account pages only | Access ended (cancelled at period end, grace exhausted or `halted`, or trial cancelled). Data is intact. Lasts 30 days. |
| `archived` | `locked`: re-purchase and export download only (owner) | Expiry + 30 days. Logical archive (§6.4) |
| `purged` | `none` (tenant tombstone; statutory platform records only, §6.6) | Expiry + 180 days. Clinic data and files deleted |
| comp *(flag `comp_until`, not a state)* | `full` for any status except `purged` | Set by the platform admin for a pilot clinic; no provider charge needed |

`cancel_at_period_end` (boolean) and `canceled_at` are **flags**, not states, so "active but cancelling" stays `active` until the period ends.

### 6.2 The access rule (the hard stop)

One SQL function decides access, computed from **timestamps at the time of the query**, never from a job having run. It lives in a non-exposed schema (`billing_internal`), so PostgREST cannot call it.

```sql
-- access_ends_at is maintained by every transition RPC:
--   trialing, not cancelling, charge scheduled -> trial_end + pending_charge_buffer
--   trialing, cancelling                       -> trial_end                (no buffer: nothing is pending)
--   active,   not cancelling                   -> current_period_end + pending_charge_buffer
--   active,   cancelling                       -> current_period_end       (no buffer)
--   past_due                                   -> least(grace_until, halted_at)
create function billing_internal.tenant_access_level(p_tenant uuid, p_now timestamptz)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when s.status = 'purged'                                             then 'none'
    when s.comp_until is not null and p_now < s.comp_until               then 'full'
    when s.status = 'incomplete'                                         then 'onboarding'
    when s.status in ('trialing','active','past_due')
         and p_now < s.access_ends_at                                    then 'full'
    else 'locked' end                       -- includes expired, archived, and a stale status past access_ends_at
  from public.tenant_subscriptions s where s.tenant_id = p_tenant
$$;
revoke execute on function billing_internal.tenant_access_level(uuid, timestamptz) from public, anon, authenticated;
grant  execute on function billing_internal.tenant_access_level(uuid, timestamptz) to service_role;
```

**Exposure rules (security, P1):**
- `tenant_access_level`, `has_entitlement` and `entitlement_limit` with a caller-supplied `p_tenant` and `p_now` are **`REVOKE EXECUTE … FROM public, anon, authenticated`** and live in `billing_internal`. Only `service_role` (jobs) and the pgTAP tests call them directly, which is where `p_now` time travel is used.
- The RLS helpers (SECURITY DEFINER, owned by the migration role) call them internally with `now()`.
- Clients get only caller-bound wrappers in `public`, which take no `p_now` and check membership first: `public.my_tenant_access(p_tenant uuid)` returns the level only if `p_tenant` is one of the caller's active memberships (otherwise `null`), and `public.my_entitlements(p_tenant uuid)` returns the caller's own clinic's enabled keys and limits.
- **Tests:** a cross-tenant test asserts that member of clinic A gets `null` for clinic B, and that `authenticated` cannot execute any `billing_internal.*` function (§11).

**Grace and buffer: Deviation (PO to accept), SUB-D4.** The PO said access stops "automatically and forcefully … as soon as the plan expires". Two settings soften that only where a **charge is genuinely in flight**, never after a cancellation:
- **Pending-charge buffer** (`platform_settings.pending_charge_buffer_hours`, default **24**, **0 allowed**): applied only when `cancel_at_period_end = false` and a debit is scheduled at the boundary. It prevents locking a clinic whose UPI debit is scheduled for 24 Nov but executes hours later. Once the provider reports `charged`, the state becomes `active` and the period extends; on failure the state becomes `past_due`.
- **Failed-debit grace** (`plans.first_charge_grace_days` default **4**, `renewal_grace_days` default **7**, **0 allowed**): applies **only to a failed debit**, never to a cancellation. The first-charge grace is at least 4 days because Razorpay's last retry runs on T+3 [S16]. Grace also ends immediately when the provider reports `halted`. With 0, a failed debit locks at once and a later successful retry unlocks automatically (late success, §6.3).
- **"Forcefully" (R5)** is satisfied because the very next request after `access_ends_at` is denied by RLS, storage policies and the guards, even if the lifecycle job never ran. The job only tidies the stored `status`, writes events and sends notifications.

### 6.3 Transitions, timers and notifications

Notifications go to the **owner(s)**. **Email is the default channel** (transactional sender chosen by the authentication track, AUTH-03 SES). **WhatsApp is opt-in** per owner (MSG91 utility template, category `account_billing`), which keeps MSG91 template costs in line with the PO's cost-saving aim. These are **owner billing notices, outside PO-8's "appointments only" scope**, which governs patient reminders. **No notification ever contains a download link or signed storage URL**; notices about exports link to the in-app page `/billing/locked` (or `/settings/billing`), which requires sign-in. All times are IST.

| # | From → To | Trigger | Timer | Notifications (before / at) |
|---|---|---|---|---|
| T1 | `incomplete` → `trialing` | Checkout signature verified, `subscription.authenticated`, or `fetchSubscription` on return (§5.4) | — | At: "Trial started, ends 24 Nov, ₹1,768.82 (₹1,499 + GST) on 24 Nov" |
| T2 | `trialing` → `active` | `subscription.charged` (first) | `start_at` = day 15, 10:00 | **Before: trial_end − 3 days and − 1 day** ("₹1,768.82 (₹1,499 + GST) will be debited on …; cancel anytime"). At: receipt + GST invoice |
| T3 | `trialing`/`active` → `past_due` | `payment.failed` / `subscription.pending`, or the time rule (no charge by anchor + buffer) | grace = 4 days (first debit) / 7 days (renewal), or until `halted` | At: "Payment failed: update method". Again at grace − 2 days and − 1 day |
| T4 | `past_due` → `active` | `subscription.charged` (a retry succeeded) | — | At: "Payment received" |
| T5 | `past_due` → `expired` | `now ≥ grace_until`, or provider `halted` | — | At: "Access paused: data safe for 30 days; renew to continue" |
| T6 | `active` (cancel flag) → `expired` | `now ≥ current_period_end`; provider `cancelled` at cycle end | — | At cancel request: "Cancelled; access until <date>". **Before: period end − 3 days** ("Your access ends on <date>; sign in to download your data or resume"). At: lock notice |
| T7 | `trialing` (cancelled) → `expired` | `now ≥ trial_end` | — | As T6 |
| T8 | `expired` → `active` | **Re-purchase**: a new subscription with immediate start; the first charge succeeds | — | At: "Welcome back" |
| T9 | `expired` → `archived` | `now ≥ expired_at + 30 d` | lock window **30 days** | **Before: 7 days and 1 day before archive**: "Sign in to download your data" (link to `/billing/locked`). At: "Data archived; recoverable until <purge date>" |
| T10 | `archived` → `active` | Re-purchase (as T8), then an instant logical restore | — | At: "Restored" |
| T11 | `archived` → `purged` | `now ≥ expired_at + 180 d` **and** pre-purge notices sent **and** an export exists or was offered **and** admin approval (SUB-D7) | purge horizon **180 days** | **Before: 30, 7 and 1 days before purge**, linking to `/billing/locked`, with a fiduciary warning (§6.5). At: "Data permanently deleted" + a deletion certificate (an event ID and a counts summary) |
| T12 | Any non-terminal → owner deletion request | DPDP/contract erasure at the clinic's request | Immediate provider cancel; export offered; purge after **7-day** cooling-off | As T11, compressed |

**Mandate revoked externally while `active`:** set `cancel_at_period_end = true` (`cancel_source = 'upi_app'`), set `access_ends_at = current_period_end` (no buffer), notify "Your AutoPay was cancelled from your UPI app. Access continues until <date>. Re-enable to continue", then T6.

**Late success after the lock:** if a retry succeeds after `expired`, apply T8 automatically. The clinic is unlocked; nothing is refunded.

**Charge after a cancel (race):** if a debit lands after the owner cancelled, auto-create a refund job and notify. This is rare but must not need the PO.

**Locking side effects at `expired`** (in the same transition RPC, P1):
- All `document_share_tokens` of the tenant are set to `revoked_at = now()` (patient share links stop working), except as decided in SUB-D6 for prescription verification.
- API keys are suspended (re-enabled on T8/T10); outbound webhook subscriptions are paused.
- Signed URLs already issued expire on their own; the maximum TTL is short (§7.2), so no long-lived link outlives the lock.

### 6.4 Archive design and cost reasoning

**Problem:** the PO's words "move all the data to archive … extract on re-purchase" suggest physically moving the rows out of the database and restoring them later.

**Cost facts (Supabase Pro pricing, 2026-11-10 [S22]):**
- Database disk $0.125/GB-month beyond 8 GB.
- File storage $0.0213/GB-month beyond 100 GB.
- PITR $100/month per 7 days of retention.

**Assumption (validate), estimated footprint of one busy small clinic per year:**
- About 50 visits/day × 300 days = 15,000 visits.
- Rows across visits, prescriptions, invoices, audit, queue and messages at ~5 KB per visit → **~75–100 MB of database rows**.
- Prescription PDFs at ~50 KB each → ~0.75 GB.
- Lab document uploads (PO-5 keeps document upload) → ~1–3 GB.
- Files are already in object storage.

| Approach | Monthly saving per archived clinic | Engineering risk |
|---|---|---|
| Move rows from Postgres to an export bundle in object storage | ~0.1 GB × ($0.125 − $0.0213) ≈ **$0.01** | **High**: a bespoke export/import for 40+ tenant tables with FKs, audit chains, sequences (invoice numbers) and storage paths. Restore bugs corrupt medical records. Every schema change must stay restorable for 180 days. |
| Move files to a colder tier | Supabase Storage has no cold tier. S3 Glacier IR (Mumbai) would save ~$0.01–0.02/GB-month on ~2 GB ≈ **$0.03** | Medium: a second storage vendor and restore latency |
| **Logical archive (Recommended)**: rows and files stay in place, access is fully revoked, derived and ephemeral data is deleted, and an export snapshot is produced | ~0 (derived data such as message logs, AI logs, sessions and job rows is deleted) | **Low**: restore is a status flip; no data transformation |

**Conclusion (Recommendation, P1):**
- The real cost driver is **how long data is kept, not where it sits**. The PO's 180-day cap is what bounds cost, and a hard purge enforces it.
- In v2.0, `archived` means:
  1. All tenant access is denied by RLS and storage policies (as when expired), and only the owner can reach the re-purchase and export pages.
  2. Derived data is deleted: `communication_queue` history, AI logs, webhook delivery logs, job rows, API keys (revoked) and outbound webhook subscriptions (disabled).
  3. A final **export snapshot** is generated (§6.5) and kept in a private, India-region bucket until purge.
  4. Scheduled jobs skip the tenant: no reminders, no webhooks, no API.
- **Revisit trigger:** if archived tenants ever exceed ~5% of database size or ~50 GB of storage, add a physical cold tier (P3).
- **SUB-D3** asks the PO to accept this reinterpretation.

**Backups:** purged data persists in Supabase daily backups or PITR **only for the backup retention window**. **Assumption (validate):** 7 days on Pro, longer with the PITR add-on. The deletion certificate states this. On Supabase Free (PO-17), purged data persists in the FT-02 encrypted dumps, including the pre-purge on-demand dump, for up to 30 days. The deletion certificate states 30 days while on Free.

### 6.5 Data export (fiduciary protection)

- **Fact:** clinics are the data fiduciaries for patient records (`DATA_HANDLING.md:13-20`). Medical-record retention obligations (IMC reg. 1.3.1, 3 years and longer under state rules; `DATA_HANDLING.md:97,104`) belong to the **clinic** and outlive a 180-day SaaS purge.
- **Recommendation (P1):** an owner-only **"Download all clinic data"** action on `/settings/billing` and `/billing/locked`, available while `trialing`, `active`, `past_due`, `expired` and `archived`:
  - It runs as a background job (V2-04 `jobs`, kind `tenant.export`). The output is a ZIP containing:
    - per-entity CSV + JSON (patients, visits, diagnoses, prescriptions, invoices, payments, appointments, lab documents index, referrals, consents, audit log);
    - all stored files (prescription PDFs, lab documents);
    - a `README` with the schema and a manifest with counts and SHA-256 hashes.
  - **Protection (stated precisely):** the bundle is written to a **private** Supabase Storage bucket (Mumbai) and relies on **Supabase's platform encryption at rest only**; there is no per-export key in v2.0. Storage policies on the export bucket allow **no** access to `authenticated` users; only the export job (service role) writes it.
  - **Who can read it:** only the clinic **owner**, in-app, after **re-authentication** (password, plus TOTP if enrolled). The server then mints a **signed URL valid 15 minutes** and redirects the browser to it; the URL is never emailed, sent on WhatsApp, logged or stored. Each download writes an audit event.
  - **No platform-admin path:** no admin page or `platform.*` RPC lists, reads or mints URLs for export bundles (consistent with §9.2 "no clinical data"). Residual: anyone with the service-role key or the Supabase dashboard could technically read the bucket; this is the same trust boundary as the live database. **P3 option:** per-export encryption (age/AES) with a key derived from an owner-chosen passphrase, if the PO wants exports unreadable even to the operator.
  - Export bundles are deleted 30 days after creation, or at purge.
  - **Sizing:** must stream (no whole-tenant in-memory load) and stay within Vercel function limits, by chunking per table and per file batch. **Assumption (validate)** in the SUB-06 spike.
- **Warnings:** at T9 and T11 the notice states plainly: "You are responsible for retaining medical records as required by law. clinicOS will permanently delete this data on <date>. Sign in to download it." Purge (T11) is **blocked** unless the pre-purge notices were delivered (or failed with retry) and an export was offered. A platform admin can override this only with a recorded reason.
- **Compliance note (Risk, residual):**
  - The PO declined legal counsel (PO-10..18, PO-12).
  - Deleting a fiduciary's medical records at 180 days, even after notice and export, carries a residual risk if a clinic later claims it could not retain its records.
  - Mitigations: the export, repeated notices, a deletion certificate, and Terms of Service that state the retention policy explicitly (SUB-10).
  - This is recorded, not blocking.

### 6.6 What survives the purge (statutory platform records)

**Problem:** "clinical and operational data deleted, tombstone only" is unsafe as written, because clinicOS's own records about the clinic as a **customer** have legal retention periods that exceed 180 days.

| Record | Retention after purge | Basis | Content limit |
|---|---|---|---|
| `saas_invoices` (incl. credit notes), `saas_payments`, `saas_refunds`, `saas_invoice_sequences`, `coupon_redemptions` referenced by an invoice (§14.3), the billing-profile snapshot (legal name, GSTIN, state, address) and `subscription_events` that relate to money | **72 months** from the due date of the annual return for the financial year (configurable) | CGST Act s.36: books kept at least 72 months from the last date of filing the annual return, longer if proceedings are pending [S27] | No patient data. The billing profile is copied into the invoice rows at issue time, so `billing_profiles` itself can be deleted. |
| `platform_audit_log`, other `subscription_events`, PII-minimised security and access logs (sign-ins, admin actions) | **1 year** from creation (configurable) | `DATA_HANDLING.md:109` (audit/access logs ≥ 1 year; security logs ≥ 180 days, CERT-In); DPDP Rules 2025 Rule 8(3) one-year retention of personal data, traffic data and processing logs [S28] (Rule 8 reported to take effect about **13 May 2027**, 18 months after notification; **Unconfirmed** against the gazette text) | Actor IDs, event types, timestamps; no clinical content |
| `tenants` tombstone (id, name, `purged_at`, deletion-certificate counts) | 72 months (tied to the invoices that reference it) | Referential integrity of the records above | No clinical data |
| **Everything else**: the clinic's clinical and operational rows, `audit_logs` of clinical activity, storage objects, export bundles, memberships, `billing_profiles`, `provider_webhook_events` | **Deleted at purge** | R8 | — |

- **Recommendation:** these survivors live in tables with `ON DELETE` rules that do not cascade from tenant deletion (FKs to `tenants` restricted to the tombstone), and a nightly `platform.retention_sweep` job deletes them at their own horizons.
- `provider_webhook_events.payload` contains customer email, phone and VPA, so the payload is **nulled after 90 days** regardless of tenant state (the row keeps `event_id`, type and timestamps for dedupe and audit).

---

## 7. Entitlements and enforcement

### 7.1 Data model (Recommendation)

All of these are new tables in the `public` schema (the internal functions are in `billing_internal`, platform RPCs in `platform`). The `saas_` prefix is used wherever a clinic-billing name already exists.

| Table | Key columns | Notes |
|---|---|---|
| `plans` (the product catalogue) | `id`, `code` (`standard`, `standard_trial`; future `ai_assist`, `ai_voice_receptionist`), `kind` (`base`/`addon`/`trial`), `category` (`core`/`ai`), `name`, `description`, **`purchasable`** (bool; the backend switch, PO-21), **`visibility`** (`public`/`coming_soon`/`hidden`), `trial_days` (14), `trial_plan_id` (Standard → `standard_trial`), `first_charge_grace_days` (4), `renewal_grace_days` (7), `status` | Configurable via SQL (R2) and the V2-13c Plans & prices screen. `standard_trial` is a non-public plan whose entitlements are Standard + `ai.scribe` at the 1,500-draft trial quota (R3, PO-21). **v2.0 seeds:** `standard` purchasable/public; `ai_assist` and `ai_voice_receptionist` with `purchasable = false`, `visibility = 'coming_soon'` and no active provider price (AI-18). `platform.set_product_availability` refuses `purchasable = true` while a product has no active price with a provider plan ID. |
| `plan_prices` | `id`, `plan_id`, **`billing_model`** (`flat_recurring` / `per_unit_recurring` / `metered` / `included_plus_overage` / `prepaid_pack`), **`base_amount_paise`** (149900; GST-exclusive), **`tax_rate_bp`** (1800), **`tax_inclusive`** (false, PO-20), **`charge_amount_paise`** (generated: base + GST rounded to the paisa = 176882; this is the provider plan amount for flat prices), `currency` ('INR'), `interval` ('month'), `interval_count` (1), `unit` (e.g. `month`, `seat`, `draft`, `minute`), `included_units`, `unit_amount_paise`, `overage_unit_amount_paise`, `tiers` (jsonb, optional), `provider` ('razorpay'), `provider_plan_id` (null for prices not yet sold), `active_from`, `active_to` | **Versioned and never updated in place.** Razorpay plans are immutable, so a new price or tax rate means a new provider plan and a new row. Only `flat_recurring` is wired to Razorpay in v2.0; the other models describe future products (e.g. a per-minute voice receptionist), whose billing mechanism is chosen when they launch (Razorpay subscriptions charge a fixed amount, so metered billing needs its own design, **Open question** for that release). Replaces `amount_paise` and `gst_rate_bp` from revision 2. |
| `entitlement_keys` | `key` (e.g. `core.*`, `assist.terminology`, `ai.scribe`, `ai.scribe.monthly_drafts`, `messaging.monthly_quota`), `kind` (`boolean`/`limit`), `description`, `owner_doc` | Named `entitlement_keys`, not `features`, to avoid confusion with the `features/` code directory. `ai.*` and `assist.*` rows are seeded from `AI_STRATEGY.md` §6.2 (C35). |
| `plan_entitlements` | `plan_id`, `key`, `enabled`, `limit_value` | E.g. `standard_trial`/`ai.scribe`/true and `standard_trial`/`ai.scribe.monthly_drafts`/1500 (PO-21); `standard`/`ai.scribe`/false (PO-25 default; set to true with a limit to keep the preview for paying clinics). Rows for the future `ai_assist` product are seeded but unused while it is not purchasable. Boolean keys use `enabled`; limit keys use `limit_value`. The **limit value lives here**; **usage** lives in the AI track's `ai_usage_monthly`, checked by `ai_reserve` (`AI_STRATEGY.md` §4.6). |
| `tenant_entitlement_overrides` | `tenant_id`, `key`, `enabled`, `limit_value`, `expires_at`, `reason`, `granted_by` | Comp / pilot / AI evaluation |
| `tenant_subscriptions` | `tenant_id` (PK), `plan_price_id`, `status`, `trial_start`, `trial_end`, `current_period_start`, `current_period_end`, `access_ends_at`, `cancel_at_period_end`, `canceled_at`, `cancel_source` (`owner`/`upi_app`/`admin`/`provider`), `past_due_since`, `grace_until`, `halted_at`, `expired_at`, `archive_at`, `archived_at`, `purge_at`, `purged_at`, `comp_until`, `provider`, `provider_customer_id`, `provider_subscription_id`, **mandate columns** `mandate_method` (`upi`/`card`), `mandate_display` (masked VPA or network + last 4), `mandate_max_paise`, `mandate_authenticated_at`, `mandate_revoked_at`, `trial_consumed`, `version` | The **base** subscription only; one row per tenant. Replaces v1 `subscriptions`. Mandate details are folded in (one active mandate per subscription), which removes a separate `payment_mandates` table. Updated **only** by SECURITY DEFINER transition RPCs. |
| `tenant_addons` (**deferred with SUB-11**, C41; not created in v2.0) | `id`, `tenant_id`, `addon_plan_price_id`, `status` (same state set, minus archive/purge), `current_period_end`, `access_ends_at`, `cancel_at_period_end`, `provider_subscription_id`, mandate columns as above, `version`; unique (`tenant_id`, addon plan) where status is live | **Needed because the one-row-per-tenant PK on `tenant_subscriptions` cannot represent a second provider subscription** (§7.4). |
| `subscription_events` | `id`, `tenant_id`, `subject` (`base`/`addon:<id>`), `type`, `from_status`, `to_status`, `actor_type`, `actor_id`, `reason`, `provider_event_id`, `payload` (no PII), `occurred_at` | Append-only (no UPDATE/DELETE grants). Survives purge (§6.6). |
| `saas_payments` | `id`, `tenant_id`, `subject`, `provider_payment_id` UNIQUE, `amount_paise`, `status`, `method`, `captured_at`, `refunded_paise` | Replaces v1 `payment_records`. Survives purge. |
| `saas_invoices` | `id`, `tenant_id`, `number` UNIQUE (e.g. `CQ/2026-27/000123`), `fy`, `seq`, `period_start`, `period_end`, line items (base and add-on), `taxable_paise`, `cgst_paise`, `sgst_paise`, `igst_paise`, `total_paise`, `place_of_supply`, `buyer_legal_name`, `buyer_gstin`, `buyer_address`, `sac`, `status`, `provider_invoice_id`, `saas_payment_id`, `pdf_path`, `credit_note_of` | Separate from the clinic `invoices` (`000009…sql:12`). Buyer details are snapshotted. Survives purge. |
| `saas_invoice_sequences` | `fy` (PK), `next_seq` | Gapless allocation under a row lock, in the same transaction as the invoice insert. Same FY logic as PO-4 (shared `lib/fy`). |
| `billing_profiles` | `tenant_id`, `legal_name`, `gstin`, `state_code`, `address`, `billing_email`, `whatsapp_billing_opt_in` | |
| `provider_webhook_events` | `event_id` (PK = `x-razorpay-event-id`), `event_type`, `received_at`, `signature_valid`, `payload` (PII-minimised; nulled after 90 days), `processed_at`, `attempts`, `last_error` | Dedupe + audit |
| `platform_settings` | Single row: `lock_window_days` (30), `purge_after_days` (180), `pending_charge_buffer_hours` (24), `gst_retention_months` (72), `log_retention_days` (365), `supplier_gstin`, `supplier_state`, `sac` | Configurable via SQL |
| `platform_admins`, `platform_audit_log` | §9 | |

That is 14 tables plus 2 platform tables, down from 16; v2.0 creates 13 of them (`tenant_addons` waits for the first purchasable add-on).

**RLS:**
- Tenant owner/admin can SELECT their own `tenant_subscriptions`, `tenant_addons` (when it exists), `saas_invoices`, `saas_payments` and `billing_profiles`.
- Owner/admin can UPDATE `billing_profiles` through a command.
- Everything else is reachable only through RPCs. `plans`, `plan_prices` and `plan_entitlements` where `is_public` are readable by `authenticated` users.
- Platform tables have **no** tenant access.

### 7.2 Enforcement layers (never UI-only)

1. **Database (authoritative):**
   - `billing_internal.tenant_access_level(tenant, now)` (§6.2), `billing_internal.has_entitlement(tenant, key, now) returns boolean` and `billing_internal.entitlement_limit(tenant, key, now) returns bigint`. Not executable by `public`, `anon` or `authenticated` (§6.2).
   - **`has_entitlement` resolution order:** (1) access level must be `full`; (2) a non-expired `tenant_entitlement_overrides` row wins; (3) if status is `trialing`, use the plan's `trial_plan_id` entitlements (Standard + `ai.scribe` at the 1,500-draft trial quota); (4) otherwise the base plan's entitlements (plus, once SUB-11 ships, the entitlements of each `tenant_addons` row whose `access_ends_at > now`). `entitlement_limit` follows the same order and returns the largest applicable limit.
   - `has_entitlement` is necessary but **not sufficient** for AI: owner opt-in, kill switch and quota are enforced by the AI track (`AI_STRATEGY.md` §4.6).
   - **The tenant-membership RLS helper** (today `current_user_tenant_ids()`, `000001_foundation.sql:32`, being reworked in V2-05) returns **only tenants whose access level is `full`** for all clinical and operational tables.
   - A separate helper, `current_user_billing_tenant_ids()`, includes `locked` and `onboarding` tenants, but only for owner/admin, and is used **only** by the billing, subscription, export and profile policies.
   - **Storage (P1):** the `storage.objects` policies for every tenant bucket (prescription PDFs, lab documents, letterheads) use the **same `full`-access helper** on the tenant UUID path prefix, so a locked tenant's files cannot be read, listed or uploaded through the Storage API.
   - **Signed URLs:** maximum TTL **5 minutes** for in-app document views and **15 minutes** for export downloads (§6.5). Share tokens are revoked at `expired` (§6.3).
   - Result: an expired clinic's data and files are unreachable even through a buggy server action, a direct PostgREST call or a direct Storage API call.
   - **Risk (performance):** helpers are `STABLE`, indexed on `tenant_subscriptions(tenant_id)` and evaluated once per statement through the `(select …)` wrapping pattern. Verify with `EXPLAIN` in V2-05.
2. **Server guard:**
   - Extend `requirePermission` (`lib/permissions/guards.ts:16`) so that it calls `assertTenantAccess('full')` after resolving the membership. A typed `TenantLockedError` lets the UI redirect.
   - Add `requireEntitlement(featureKey)` for AI and other gated features. It is called in the server command and route handler, not only in components.
   - `/api/v1` key authentication (`lib/api/auth`) returns `402 Payment Required` with an error code for locked tenants.
   - Job handlers (reminders, webhooks, PDFs) check `tenant_access_level` before acting, so **no patient reminders are sent from a locked clinic**.
3. **Layout redirect (UX):**
   - `app/(dashboard)/layout.tsx:22-29` already resolves membership. Add: if the access level is `locked`, redirect owner/admin to `/billing/locked` (renew, export, invoices) and other roles to `/billing/locked/staff` ("Your clinic's subscription is inactive; contact the owner").
   - If `onboarding` (status `incomplete`), redirect to `/onboarding/billing` (the AUTH track's resume rule).
4. **Middleware: UX only.** `middleware.ts` runs on every request, and a database call there adds latency to every route. **Recommendation:** do **not** query the database in middleware. Optionally read a short-lived signed `access_hint` cookie, set by the layout, to avoid one redirect hop. It is never treated as authorisation.
5. **Public patient links:**
   - Reschedule and booking links for a locked tenant show a neutral "This clinic's online services are unavailable" page.
   - Prescription verification links (`app/r`): **SUB-D6**. Default: while `expired`, the page shows **verification metadata only** (clinic name, doctor name and registration number, issue date, "valid prescription"), with **no PDF and no signed URL**; disabled at `archived`.

### 7.3 AI gating (requirement #1)

**Owner of the keys:** `AI_STRATEGY.md` §6.2 (C35). This doc only stores them in `entitlement_keys` and decides which plan enables them. The table below is copied from AI §6.2. **Round 2 (C41):** no add-on is sold in v2.0, so the `ai_assist` column describes the future, not-yet-purchasable product; in v2.0 a key is effective when the base plan, the trial plan or an override enables it.

| Key | Kind | `standard` | future `ai_assist` (not purchasable in v2.0) | During `trialing` (`standard_trial`) |
|---|---|---|---|---|
| `assist.terminology`, `assist.frequent_rx`, `assist.shorthand`, `assist.snapshot`, `assist.slots`, `assist.duplicates`, `assist.followup`, `assist.allergy_check` | boolean | ✓ | — (comes from the base plan) | ✓ |
| `assist.dup_therapy`, `assist.help`, `assist.vitals` (if time permits) | boolean | ✓ | — | ✓ |
| `ai.scribe` | boolean | ✗ | ✓ | ✓ |
| `ai.scribe.monthly_drafts` | limit (per clinic, pooled) | 0 (PO-25 default) | Set when the product launches | **1,500** for the trial (PO-21), labelled "Preview" |
| `ai.operations_copilot`, `ai.clinical_copilot`, `ai.patient_advice`, `ai.scribe.voice` | boolean | ✗ | ✗ in v2.0 | ✗ |
| `core.*`, `messaging.monthly_quota` (limit, SUB-D2) | boolean / limit | ✓ | — | ✓ |

- **No AI price exists in v2.0** (PO-21): `ai_assist` has no active price or provider plan. AI_STRATEGY D-1's ₹499 estimate is kept only as an input for the later launch; AI products (including the AI Voice Receptionist) will be priced then, possibly on a metered model.
- Removed in v2.0 and therefore **not seeded as enabled**: the LLM catch-up summary (replaced by deterministic `assist.snapshot`); the clinical copilot (`ai.clinical_copilot`, deferred indefinitely) and the operations copilot (`ai.operations_copilot`, v2.1) are seeded as keys but disabled everywhere. Retired names: `assist.icd10_lookup`, `ai.catchup_summary`, `ai.monthly_token_quota`, `assist.smart.*`, `ai.copilot.*`.
- **Recommendation:** each `ai.*` server entry point calls `requireEntitlement` **before** building the prompt, then `ai_reserve` for the quota.
- **UI (PO-21):** no "Available with AI Assist" upsell. During the trial the scribe carries a **"Preview"** chip and the note "AI features are in preview and not yet offered as a paid product"; no quota meter or price is shown (a clear message appears only if the 1,500 drafts run out). Plan and billing pages show one **"AI features: Coming soon"** row with no price or buy button. After the trial (PO-25 default) the scribe is not shown in the consult screen. All of this is presentation only; the server check is `requireEntitlement`.

### 7.4 Billing the AI Assist add-on (SUB-D8)

> Update (2026-11-10, PO round 2, C41): **deferred.** No AI product is sold in v2.0; SUB-11 and `tenant_addons` are built at the AI Voice Receptionist launch. The analysis below stays as the reference for future **flat-fee** add-ons. A metered product (per minute or per call) needs its own mechanism, because Razorpay subscriptions charge a fixed amount and add-ons fail on UPI-authorised subscriptions [S26].

**Fact (verified 2026-11-10):** a Razorpay subscription authorised via UPI or eMandate cannot be updated [S25], add-ons cannot be created on UPI-authorised subscriptions, and add-ons are one-time charges on the next invoice, not recurring [S26].

| Option | Assessment |
|---|---|
| **(a) A second Razorpay subscription for the add-on, with its own mandate (Recommended)** | Independent: the owner can start or cancel AI Assist without touching the base subscription. Same code path as the base (create, authorise in the modal, webhooks, reconcile). Cost: a second AFA at purchase, and two debits a month (two pre-debit alerts). Its period anchors on its own purchase date (no proration). Cancelling the base cancels the add-on at the same time (its access is also bounded by base access `full`). |
| (b) Cancel the base and recreate with a combined "Standard + AI" plan | One debit, but every add or remove needs a full re-mandate of the base plan; a failure mid-swap risks the clinic's base access. More complex than (a). |
| (c) Create a one-time add-on via the API each cycle | **Rejected:** fails on UPI subscriptions outright [S26] and is fragile even on cards. |

- **Data model:** `tenant_addons` (§7.1), one row per live add-on subscription. The current `tenant_subscriptions` PK (`tenant_id`) cannot represent option (a), which is why add-ons have their own table.
- **Invoices:** each charge (base or add-on) gets its own `saas_invoices` row.
- **Trial:** no add-on subscription is needed during the trial; AI comes from `standard_trial`. At trial end, AI keys switch off (PO-25 default); the trial-end notice says the AI preview ends with the trial.
- **Backlog:** SUB-11 (M), **deferred** (C41).

---

## 8. Configuration: SQL first, then admin UI

### 8.1 SQL-first (v2.0 phase SUB-01)

The seed migration creates `standard` with a `flat_recurring` price of base 149900 paise, `tax_rate_bp` 1800 and `tax_inclusive = false` (PO-20; charge 176882 paise), monthly, 14-day trial, grace 4/7; `standard_trial` with `ai.scribe` enabled and `ai.scribe.monthly_drafts` = 1500 (PO-21); and the AI catalogue rows `ai_assist` and `ai_voice_receptionist` with `purchasable = false`, `visibility = 'coming_soon'` and no active price (AI-18). A runbook file, `docs/runbooks/subscriptions-sql.md` (created in SUB-01, not now), contains vetted snippets that **call RPCs, never raw UPDATEs**:

```sql
-- New price for NEW subscriptions (old price rows stay for grandfathered tenants).
-- Arguments: plan, billing model, base amount (paise, GST-exclusive), tax rate (bp), tax_inclusive,
-- provider plan ID (created in Razorpay for the derived charge amount), active from.
select platform.create_plan_price('standard', 'flat_recurring', 179900, 1800, false, 'plan_RZPxxxxxxxx', '2027-04-01+05:30', p_actor => '<admin_user_id>');
-- Make a future product purchasable (refused while it has no active price with a provider plan ID)
select platform.set_product_availability('ai_voice_receptionist', p_purchasable => true, p_visibility => 'public', p_actor => '<admin_user_id>');
-- Extend a trial
select platform.extend_trial('<tenant_id>', interval '7 days', 'pilot clinic', p_actor => '<admin_user_id>');
-- Grant AI evaluation
select platform.grant_override('<tenant_id>', 'ai.scribe', true, null, now() + interval '30 days', 'AI pilot', p_actor => '<admin_user_id>');
select platform.grant_override('<tenant_id>', 'ai.scribe.monthly_drafts', true, 1500, now() + interval '30 days', 'AI pilot', p_actor => '<admin_user_id>');
```

**Actor resolution (security, P1).** `is_platform_admin()` requires a JWT with `aal = 'aal2'`; the SQL editor and the service role have no JWT, so the RPCs use an explicit branch:

```sql
-- inside every platform.* RPC
if current_user in ('postgres', 'service_role') then
  -- SQL editor / service role: no JWT. p_actor is required and must be a row in platform_admins (not revoked).
  v_actor := p_actor;
  if v_actor is null or not exists (select 1 from public.platform_admins
                                    where user_id = v_actor and revoked_at is null) then
    raise exception 'p_actor must be an active platform admin';
  end if;
  v_channel := 'sql';
else
  -- Any JWT caller: p_actor is IGNORED; the actor is auth.uid(), and aal2 + platform_admins are required.
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  v_actor := auth.uid();
  v_channel := 'ui';
end if;
```

- `platform.*` functions are `REVOKE EXECUTE … FROM public, anon` and granted to `authenticated` only so the admin UI can call them (each checks `is_platform_admin()` as above). **Tests:** an `authenticated` user who is not a platform admin, and a platform admin at aal1, both get `forbidden`; a JWT caller passing someone else's `p_actor` is recorded as themselves (§11).
- Every call writes `platform_audit_log` (with `v_channel`) and `subscription_events`.

### 8.2 Price changes, plan changes and the mandate

- **Fact (§3.1):** a UPI- or eMandate-authorised Razorpay subscription cannot be updated [S25]. A price or plan change therefore means **cancelling and creating a new subscription, with a new mandate authorisation (AFA)** by the owner. Card subscriptions can technically be updated, but using one mechanism for all methods keeps the code minimal.
- New `plan_prices` row → a new Razorpay plan ID → applies to **new** subscriptions.
- Existing clinics keep their price (grandfathered) until migrated by a **re-authorisation campaign**: the owner authorises a new subscription starting at the current period end; the old one is cancelled at cycle end.
- **Update payment method** uses the same mechanism (new subscription from the next anchor, old one cancelled at cycle end). There is no separate "update link" method.
- Adding or removing a future add-on never touches the base subscription (§7.4; no add-on is sold in v2.0).
- A change of GST rate is a price change: new `plan_prices` row, new Razorpay plan, re-authorisation campaign.

---

## 9. Platform admin portal

### 9.1 Same app or a separate app (Recommendation)

| Option | Assessment |
|---|---|
| **Same Next.js app, route group `app/(platform)/platform/**` (Recommended)** | One deploy, one design system (**Clinic Paper (shadcn/Radix)**, `DESIGN_SYSTEM.md`), one auth stack, one CI. Cost: discipline to keep tenant and platform code apart (lint boundary: `features/platform/**` importable only from `app/(platform)`). |
| Same app on an `admin.` subdomain | Separate cookie jar, so a tenant session cannot reach admin. Adds host-based middleware rewriting and a second Supabase cookie domain. **Optional hardening later (P3).** |
| Separate app/repo | Two deploys, duplicated auth, UI and types, and drift. Not justified for one person. **Rejected.** |

The PO said "maybe a separate app (not sure)"; the recommendation is the same app. This is a design recommendation within Claude's remit, not a blocking PO decision; the PO can overrule.

### 9.2 Security model (Recommendation, P1)

- `platform_admins(user_id PK, created_by, created_at, revoked_at)` is **not a tenant role** and is never derived from `memberships`. `is_platform_admin()` is a SECURITY DEFINER function that checks the table **and `auth.jwt()->>'aal' = 'aal2'`**.
- **TOTP MFA is mandatory** (Supabase MFA, `AUTH_REDESIGN.md` §4.6). Admin routes enforce aal2 in the layout and in every RPC. **Platform-admin TOTP enrolment and the aal2 checks are built in V2-13c** (pulled forward from V2-14 plan 14-03, which keeps owner MFA and session policy).
- Use a **dedicated admin identity**: a separate email from the PO's clinic-owner test accounts.
- Every admin action is a SECURITY DEFINER RPC in a `platform` schema (§8.1 actor rule). **There is no service-role key in request paths** (consistent with `TARGET_ARCHITECTURE.md` §3 rules). Each RPC writes `platform_audit_log`, which is append-only and records actor, channel, action, target tenant, before/after and reason.
- **No access to clinical data or export bundles.** Admin views show tenant metadata, owner contact, subscription and payment data, row counts and storage size. Support "impersonation" is out of scope for v2.0.
- `noindex`, CSP and a separate rate limit. Admin sessions time out after 30 minutes idle.
- Bootstrap: the first admin is inserted by migration or SQL with the PO's user ID. Admins cannot be added through the UI in v2.0.

### 9.3 Capabilities (scoped for a one-person team)

| Capability | v2.0 (P1) | Later (P2/P3) |
|---|---|---|
| Tenant list: status, trial/period/grace dates, plan, add-ons, owner, created | ✓ (read) | Search and filters, cohort and churn charts |
| Tenant detail: subscription events timeline, payments, invoices, masked mandate, webhook events | ✓ (read) | |
| Extend trial; grant/revoke comp (`comp_until`); entitlement overrides (AI evaluation) | ✓ | |
| "Reconcile now" (refetch from provider) | ✓ | |
| Data lifecycle queue: upcoming archives/purges, export status, **purge approval** (typed confirmation after dry-run counts) | ✓ | Fully automatic purge after a track record |
| Force-cancel / force-expire / un-archive (with reason) | SQL RPC only | UI (P2) |
| Plans and prices | **Minimal "Plans & prices" screen** (C40): list products and price versions with their billing model and GST-exclusive amounts; add a new price version through `platform.create_plan_price`; edit trial length, grace, buffer and quota limits through `platform_settings`/`plan_entitlements` RPCs; **product availability switch** (`purchasable`, `visibility`; PO-21). SQL RPCs (§8.1) remain the fallback | Plan creation, archiving and bulk re-pricing UI (P2) |
| Webhook event replay | — (re-run via "Reconcile now") | P2 |
| Refund a SaaS payment, credit-note PDF | **`platform.refund_payment` RPC (V2-13b) + Refund action and credit-note PDF (V2-13c)**, §14.7 (round 3) | — |
| Coupons and discounts | **SQL RPCs (V2-13b) + Coupons screen (V2-13c)**, §14.3 (round 3) | — |
| Annual plans, GSTR-1 export helper | — | P2/P3 |

---

## 10. Webhooks, reconciliation and time

### 10.1 Webhook handling (Recommendation, P1)

- **Route:** `app/api/webhooks/razorpay/route.ts`, Node runtime (same path as the roadmap and `INFRASTRUCTURE_ASSESSMENT.md`).
  - Read the **raw body** (`await req.text()`). Compute HMAC-SHA256 with `RAZORPAY_WEBHOOK_SECRET` and compare to `X-Razorpay-Signature` with `crypto.timingSafeEqual` [S18]. Reject with 400 on mismatch, and log without the payload.
  - Secret rotation in v2.0: rotate in a low-traffic window and let reconciliation catch any event rejected during the switch. Dual-secret validation (Razorpay advises validating retried old events with the old secret [S17]) is **P2**.
- **Idempotency:** `insert into provider_webhook_events (event_id = x-razorpay-event-id …) on conflict do nothing`. If the row already existed and was processed, return 200 [S18].
- **Processing:** "**event as a trigger, API as truth**". For any `subscription.*` or `payment.*` event, enqueue a `billing.sync_subscription(subject)` job (V2-04 `jobs`, `dedupe_key = provider_subscription_id + event_id`) and return 200 within milliseconds.
  - The job **fetches the subscription from the Razorpay API** and applies the transition through one RPC, `billing_internal.apply_provider_state(subject, snapshot, event_id)`, in one transaction with the event and audit rows.
  - This makes out-of-order and duplicate events harmless.
- **Subject mapping:** use `notes.tenant_id` and `notes.subject` (`base`/`addon`), set at creation, and cross-check against the stored `provider_subscription_id`. Never trust `notes` alone.
- **Secrets** (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) go in the fail-closed env schema (P1-15). Test-mode keys are allowed only outside production, and production refuses `rzp_test_` keys.

### 10.2 Reconciliation and lifecycle jobs

| Job | Schedule | Does |
|---|---|---|
| `billing.lifecycle_tick` | Every 15 min | Applies time-based transitions (T3 time rule, T5, T6, T7, T9), sets stored status and dates, revokes share tokens at `expired`, writes events, enqueues notifications. Idempotent: each transition is guarded by `version` and `from_status`. |
| `billing.reconcile` | Daily 03:00 IST (an hourly near-anchor pass is **P2**) | Fetches provider state for all non-terminal base and add-on subscriptions; applies differences; **alerts the PO** (P1-25 alert route) on any divergence that needed correction |
| `billing.notify_upcoming` | Daily 09:00 IST | T-3 / T-1 debit, period end, archive and purge notices (dedupe key per tenant + notice + date). Links only to in-app pages. |
| `tenant.export` | On demand + automatically at T9 − 7 days | §6.5 |
| `tenant.archive` / `tenant.purge` | Daily | Archive automatic; purge **after admin approval** (SUB-D7), batched, with dry-run counts first. Reuses the V2-13 DPDP purge machinery (P1-17). Leaves the §6.6 survivors. |
| `platform.retention_sweep` | Nightly | Deletes §6.6 survivors at their horizons; nulls webhook payloads after 90 days |
| `subscriptions.expire_unauthenticated`, `tenants.delete_incomplete` | Hourly / daily | §5.1 |

### 10.3 Clock and time zone

- Store everything as `timestamptz` (UTC). **Billing boundaries are computed in `Asia/Kolkata`**, which is the platform's zone, not the tenant's (IST has no DST), through `lib/datetime` (P1-21).
- Every internal SQL function that decides access or transitions takes `p_now timestamptz`. This is the hook for time-travel tests; it is never exposed to clients (§6.2).
- Display: dates are shown to clinics as "24 Nov 2026" with the time only where it matters ("access ends 24 Nov, 10:00 AM").

---

## 11. Testing approach

| Layer | What | Where |
|---|---|---|
| Pure unit | A table-driven `nextState(snapshot, event, now)` over every T1–T12 path, including late success, a charge after cancel, revoke during the trial, `halted` before grace end, and duplicate or out-of-order events | Vitest, no DB |
| DB (time travel) | pgTAP or Vitest against the local Supabase (V2-01a), calling `billing_internal.*` as `service_role` with `p_now`. **Access-level table:** `incomplete` → `onboarding`; `trialing` before/after `trial_end` and inside the buffer; **trial cancelled → locked exactly at `trial_end` (no buffer)**; active cancelling → locked at `current_period_end`; `past_due` locked at `grace_until` or at `halted_at`, whichever is first; grace and buffer set to 0; **comp on `incomplete` and on `expired` → `full`**; comp on `purged` → `none`; `archived` → `locked`. **Entitlements:** **`trialing` + `ai.scribe` → enabled with a 1,500 limit** (PO-21); `active` on Standard → disabled (PO-25 default); an override grants it with its own limit; the add-on cases (live add-on, add-on live but base locked) are added with SUB-11. **Prices:** `charge_amount_paise` = 176882 for base 149900 at 1800 bp; `set_product_availability` refuses a product without a provider price. | CI (V2-02) |
| DB (security) | **Cross-tenant:** a member of clinic A calling `my_tenant_access(B)` gets `null`; `authenticated` and `anon` cannot execute any `billing_internal.*` function. **Platform RPCs:** a non-admin `authenticated` user and an aal1 admin get `forbidden`; a JWT caller's `p_actor` is ignored; `service_role` without a valid `p_actor` fails. **RLS** denies all clinical tables for locked tenants and allows billing tables for owner/admin only. **Storage:** a locked tenant's `storage.objects` (Rx PDF, lab document) cannot be downloaded, listed or signed through the Storage API; share tokens are revoked at `expired`. Cross-tenant denial for every new table. | CI (V2-02) |
| Notifications | **No notification payload (email body, WhatsApp template variables) contains a signed storage URL** or a storage path: assert against every notice template with a regex for the storage host and `token=` | CI |
| Webhook contract | Recorded Razorpay payload fixtures (scrubbed), signed in-test with a test secret. Cover bad signature, replay (same event ID), out-of-order events, base vs add-on subject mapping, and an unknown event type that is ignored safely. | CI |
| E2E (fake provider) | `BILLING_PROVIDER=fake` drives the **full lifecycle** signup → trial (AI scribe usable) → day-15 charge → renewal → AI off without add-on → buy add-on → cancel at period end → lock → 30-day locked window → archive → re-purchase in Playwright, with a server-side clock override (`TEST_NOW`) **compiled out of production builds**. Together with the DB time-travel tests (through purge at expiry + 180 days) this is the lifecycle acceptance evidence | CI |
| Test seeds | A seed helper `seedTenantSubscription(tenant, {status:'trialing'|'active', comp?})` in `tests/helpers/tenants.ts`. **Once SUB-02 lands, every existing integration-test tenant gets a `trialing` or comped row**, otherwise all clinical tests would see a locked tenant. | With SUB-01 |
| Provider sandbox | Razorpay **test mode** on staging covers only: mandate authorisation with test UPI IDs and cards [S19], the first charge (`start_at = now + 15 min`), a failure ID to observe `pending`/`halted`, cancel, and real webhook delivery to staging. Confirm `customer_notify=false`. Renewal is tested in test mode **only if** Razorpay supports a short plan interval (**Unconfirmed**); otherwise renewal is covered by the rows above. | Staging (from V2-13b), manual checklist each release |
| **Installed-PWA devices (manual)** | On an **installed Android PWA** (phone and tablet) and an **installed iOS PWA** (iPhone and iPad): mandate via UPI Intent, via card, and via QR; close the UPI app mid-flow and reopen the PWA → status recovered by `fetchSubscription`; complete in Safari → installed app shows `trialing` on next open | Staging, before G6 |
| Security | Webhook endpoint, admin RPCs (`is_platform_admin` + aal2), no tenant path to platform RPCs, export link scope and 15-minute expiry, storage lock | V2-14 authZ matrix |

---

## 12. Decisions for the PO (only genuinely open items)

Settled and removed from this list: the mandate at signup (R4), AI in the trial (R3, `AI_STRATEGY.md` D-2), the admin portal location (§9.1, a recommendation the PO can overrule). AI pricing is settled by roadmap **PO-21 (round 2)**: no AI is sold in v2.0, and the catalogue stays configurable; this doc implements it.

| ID | Decision | Recommended default |
|---|---|---|
| **SUB-D1** ✅ | Is ₹1,499 GST-inclusive? Supply the facts: GST registration status, GSTIN, legal entity name and state. | **Decided 2026-11-10 (PO-20): exclusive**, "1499 excluding GST not including": debit ₹1,768.82 = taxable ₹1,499.00 + GST ₹269.82. The PO still supplies GSTIN, legal name and state, and registers before paid launch (G7). *Original default, superseded:* **Inclusive** (debit ₹1,499.00 = taxable ₹1,270.34 + GST ₹228.66), because most clinics provide GST-exempt healthcare and cannot claim input credit. SAC default 998314 and "register before go-live" are Claude-researched, **Unconfirmed**, configurable defaults (§4). Professional tax advice is optional. |
| **SUB-D2** ✅ (PO-23(f)) | Fair-use WhatsApp/SMS reminder quota inside the Standard plan (`messaging.monthly_quota`)? | **Yes**, number set by SQL before go-live |
| **SUB-D3** | "Archive" = logical lock + export snapshot (data stays in place, restore is instant), and 180 days counted from expiry? | **Yes, logical; 180 days from expiry** (§6.4) |
| **SUB-D4** | **Deviation:** accept the pending-charge buffer (24 h) and failed-debit grace (4 days first debit, 7 days renewal), applied only while a charge is in flight and never after a cancellation? Both can be set to 0. | **Accept** (§6.2) |
| **SUB-D5** | **Deviation:** one trial per owner account (not only per clinic)? | **Accept**, admin can override |
| **SUB-D6** | Prescription verification links (`/r/...`) while a clinic is `expired` | **Verification metadata only** (no PDF), disabled at archive |
| **SUB-D7** | Do purges need admin approval in v2.0? | **Yes**: one click per batch after the dry-run counts; automatic later |
| **SUB-D8** | AI Assist add-on billing mechanism | **Deferred (PO-21, C41):** no add-on is sold in v2.0. Reference design for flat-fee add-ons: (a) a second Razorpay subscription with its own mandate (§7.4) |
| **SUB-D9 … SUB-D11** | UAT coupon mechanics (real mandate vs comp, AI preview during UAT, UAT exit date) | See **§14.12**. SUB-D9/D10 are **adopted defaults (PO may override)**: real mandate; AI preview until UAT exit. SUB-D11 is a **PO operational input** (the UAT exit date), not an open decision. |
| (provider) | Payment provider (PO action at KYC) | **Razorpay**; get Razorpay and Cashfree quotes; switch only if Cashfree's card mandates and webhooks check out and the fee gap matters |

---

## 13. Roadmap impact

### 13.1 New backlog items (track **SUB**)

| ID | Item | Priority | Size | Depends on | Phase placement |
|---|---|---|---|---|---|
| **SUB-01** | Schema (§7.1), drop v1 `subscriptions`/`payment_records` and fix their tests, `billing_internal` access/entitlement functions (with `p_now`, revoked from clients), caller-bound `my_*` wrappers, transition RPCs, `platform.*` RPC actor rule, `create_clinic_with_owner` inserts `incomplete`, product catalogue with `billing_model`, `purchasable` and `visibility`; GST-exclusive price fields; seeds (Standard ₹1,499 + GST, `standard_trial` with 1,500 preview drafts, AI products not purchasable, AI-18), `platform.set_product_availability`, test seed helper, SQL runbook, pgTAP time-travel and security tests | P1 | M | V2-01a (local DB), V2-03 (drift baseline, generated types) | **V2-05** (with the RLS rework) |
| **SUB-02** | Enforcement: RLS tenant helper limited to `full`, billing helper, **storage policies on the same helper**, signed-URL TTL caps, `requirePermission` → `assertTenantAccess`, `requireEntitlement`, layout redirects, `/billing/locked` pages (functional), `/api/v1` 402, job handlers skip locked tenants | P1 (security-relevant: the hard stop) | M | SUB-01, V2-05 | **V2-05** |
| **SUB-03** | Razorpay integration: `BillingProvider` + Razorpay + Fake adapters, in-page modal checkout in `/onboarding/billing` with PWA recovery (§5.4), server-side signature verification, webhook route (HMAC, event-ID dedupe, sync job), cancel / resume / change method (new subscription) / re-purchase, env schema entries | P1 | L | SUB-01, V2-04 (jobs), P1-15, AUTH-04 (signup), **SUB-10 + SUB-D1 + provider KYC** | **V2-13b** (new) |
| **SUB-04** | Lifecycle jobs: `lifecycle_tick` (incl. share-token revocation), daily `reconcile` + divergence alert, `notify_upcoming`, dunning notices (email default via AUTH-03; WhatsApp opt-in via P1-13), incomplete clean-up | P1 | M | SUB-03, V2-04, AUTH-03, V2-12 (P1-13, for WhatsApp only), P1-25 alerts | V2-13b |
| **SUB-05** | SaaS GST tax invoices for the GST-exclusive price (taxable ₹1,499.00 + CGST/SGST ₹134.91 each or IGST ₹269.82 = ₹1,768.82): FY numbering (shared `lib/fy` with PO-4), buyer snapshot, PDF (@react-pdf), email, credit-note rows for refunds (PDF P2) | P1 | M | SUB-03, SUB-D1, V2-10 FY numbering (P1-06) | V2-13b |
| **SUB-08** | Clinic owner billing UI: rebuild `/settings/billing` (plan "₹1,499 + GST", status, next debit ₹1,768.82, method, invoices, cancel/resume, export, re-purchase; AI "Coming soon" row with no price or buy button), `/onboarding/billing`, banners (trial, past due, cancelling, AI preview ends with the trial), locked pages | P1 | M | SUB-03, V2-06 design system (G2-D design approval) | V2-13b |
| ~~**SUB-11**~~ **Deferred to the AI Voice Receptionist launch (C41)** | AI Assist add-on billing: `tenant_addons`, second-subscription purchase and cancel, add-on webhooks/reconcile, entitlement resolution, invoices | P1 | M | SUB-03, SUB-05, AI-18 (`AI_STRATEGY.md`), SUB-D8 | V2-13b |
| **SUB-06** | Tenant data export job (streamed ZIP, manifest, private bucket, re-auth, 15-minute in-app signed URL, audit). Includes a spike on Vercel function limits. | P1 (fiduciary protection) | M | V2-04, V2-13 | **V2-13c** (new) |
| **SUB-07** | Archive and purge: derived-data deletion, archive state, purge with dry-run + admin approval, §6.6 survivors and `platform.retention_sweep`, deletion certificate, notices at T9/T11 (in-app links only). Reuses V2-13 purge machinery. | P1 (**required before go-live**, PO-15) | M | SUB-04, SUB-06, V2-13 (P1-17) | V2-13c |
| **SUB-09** | Platform admin portal v2.0 (cut scope, §9.3): `(platform)` route group, **platform-admin TOTP enrolment + aal2 enforcement**, tenant list and detail (read), trial extend / comp / overrides, reconcile now, lifecycle queue with purge approval, **minimal Plans & prices screen** (C40) | P1 | M (+S for Plans & prices) | SUB-01..04, SUB-07, AUTH-04 | V2-13c |
| **SUB-10** | Merchant readiness: public Terms (with the retention, purge and statutory-retention policy), Privacy, Refund & Cancellation, Pricing ("₹1,499 + GST"; AI "Coming soon"), Contact pages. Start gateway KYC. **GST registration (GSTIN) before paid launch (G7); not needed for UAT start (§14.8)** (PO-20). | P1 (**long lead time; start immediately after G1**) | S | SUB-D1, provider choice | V2-00 / V2-01 (parallel, PO-driven) |

**Round 3 additions:** **SUB-COUPON-01 … SUB-COUPON-08** (coupons, discounts, refunds, credit notes, UAT operations), listed with sizes and dependencies in **§14.11**. SUB-COUPON-01/02/04/05/07 join **V2-13b**, -06 joins **V2-13c**, -03 is P2 (paid-launch promotions only), -08 runs at UAT start and exit.

**Not in v2.0 (P2/P3):** annual plans (note the ₹15,000 AFA ceiling), proration, metered-product credits (coupon kind `credit`, reserved), webhook replay UI, dual-secret webhook rotation, hourly near-anchor reconcile, admin UI for force actions and for plan creation or bulk re-pricing, a physical cold-archive tier, per-export encryption keys, an admin subdomain, support impersonation, a GSTR-1 export helper, automatic purge without approval.

### 13.2 Phase and gate changes (roadmap rows that change)

**Why the placement moved:** the first draft put SUB-04 in a "V2-10b" before V2-12 (messaging), SUB-06/07 in a "V2-11b" before V2-13 (purge machinery), and SUB-09 before V2-14 plan 14-03 (MFA). The roadmap runs its phases **one after another** (team = PO + Claude, PO-18): … V2-10 → V2-11 → V2-12 → V2-13 → V2-13b → V2-13c → V2-14 (`V2_MASTER_ROADMAP.md` §11 diagram and §13 critical path), so each of those depended on something built later. Because go-live happens only after all of v2 is finished (PO-15), nothing is lost by building the billing phases late.

Changes to `V2_MASTER_ROADMAP.md`:
- **§10.1 backlog:** add SUB-01 … SUB-11 as above.
- **§12.2 phases:** SUB-01 and SUB-02 are added to **V2-05** (so every later phase is built against access-checked RLS and storage policies). Add **V2-13b "SaaS subscriptions & billing"** (L-XL after round 2): SUB-03, 04, 05, 08 (SUB-11 deferred, C41), after V2-13. Add **V2-13c "Platform admin & tenant data lifecycle"** (L): SUB-06, 07, 09, after V2-13b. Both run **before V2-14**, so the security verification covers them.
- **§11 diagram:** `… V2-11 ► V2-12 ► V2-13 ► V2-13b ► V2-13c ► G5 ► V2-14` (sequential).
- **§14 effort table:** add V2-13b (L-XL after round 2, "Provider integration, webhooks, GST-exclusive invoices, owner signup") and V2-13c (L, "Irreversible purge, admin portal incl. Plans & prices, admin MFA"). Phases run sequentially. Remove the note that a "payment gateway" decision adds an L phase, since it is now counted.
- **P2-07 / plan 14-03:** platform-admin TOTP and aal2 move into V2-13c (SUB-09); owner MFA and session policy stay in 14-03.
- **Critical path** (*superseded by roadmap revision 5: the GSTIN is a G7/§17.2 item; V2-15 = UAT start (G6)*): V2-15 (go-live) also depends on V2-13b, V2-13c and **SUB-10/KYC being complete** (external lead time). The §17 go-live checklist adds: a live-mode Razorpay webhook verified on production; the Standard (GST-exclusive, plan amount 176882 paise) and trial price rows and the live plan ID present, with no AI plan IDs (C41); the GSTIN in `platform_settings`; the platform admin with MFA bootstrapped; a reconciliation alert tested; the installed-PWA mandate checklist passed on Android and iOS; the Terms published.
- **V2-14 security verification** adds: webhook forgery and replay, platform RPC access from tenant sessions, `billing_internal` not executable by clients, locked-tenant RLS and storage denial, share-token revocation, and export URL scope and expiry.
- **AI track dependency:** AI-03 (gating) depends on SUB-01 (`has_entitlement`, trial entitlements) and SUB-02 (`requireEntitlement`), both in V2-05 as `AI_STRATEGY.md` already assumes. AI-18 (AI catalogue rows, not purchasable, and the trial quota) moves to V2-05 with SUB-01 (C41).
- **Cross-doc note:** `AUTH_REDESIGN.md:127` "Open question SUB" is answered by R4 (mandate required; onboarding blocks the dashboard until authorised).
- **Effort:** the overall milestone stays **XL**. This track adds roughly **one L–XL slice** (two new phases plus additions to V2-05).

---

## 14. Coupons, discounts and UAT refunds

> Added 2026-11-10 (PO round 3: "we will give the refunds or coupon codes to users to test the product … Yes we need to add coupon/discount codes"; coordinator ruling R2). Coupons are **in v2.0 scope**, which supersedes "coupons: not in v2.0" in §9.3 and §13.1. Refunds move from "Razorpay dashboard + recorded event" to an **API-driven, audited platform RPC** (UI in V2-13c). External facts in this section were checked on 2026-11-10 and are cited as [S29]–[S37] in §15.

### 14.1 What the provider can and cannot do (research, accessed 2026-11-10)

| Topic | Fact (source) | Consequence for the design |
|---|---|---|
| Razorpay Subscription **Offers** | Discount type **Flat** or **Percentage** ("a percentage of the subscription amount"). Redemption type **Single use**, **Limited number of cycles** (e.g. the first 3 cycles) or **Forever**. Validity (Starting On / Expires On), Max Usage, and an **On Payment Failure** switch (let the customer pay without the offer, or block the payment). Offers are **created in the Dashboard**; no create-offer API is documented. [S29][S30] | Offers can express "once / repeating N / forever" for **new** subscriptions. Offer objects are created by hand and registered with us by ID. |
| Linking an offer | `offer_id` is passed **when creating the subscription** ("the offer must be valid and unexpired"; the plan amount must exceed the offer's minimum amount). Offers work **only with Razorpay Standard Checkout** (which we use, §5.4), India only, and apply to **UPI and card** payments (eMandate is not mentioned). [S31][S33] | Our checkout passes `offer_id` at creation. |
| Offer on an **existing** subscription | Possible only for a subscription in the **`active`** state, through the Dashboard or the **Update a Subscription** API, and it takes effect **at the end of the current cycle** [S31]. The Update API is **refused for UPI and eMandate subscriptions** [S25]. An offer can be removed with `DELETE /v1/subscriptions/:sub_id/:offer_id`, also effective at cycle end; later invoices are charged in full [S32]. | For a UPI clinic (the majority) **a coupon cannot be added after the mandate is authorised**. Admin-applied coupons after checkout use the same **cancel + new subscription (re-mandate)** path as a price change (§8.2), or a refund. |
| **100 % off / zero-amount cycles** | "Offers can only be applied if the chargeable amount after applying the Offer is **greater than ₹1**" [S29][S31]. | **Free cycles cannot be done with an offer.** They are done by **deferring the subscription's `start_at`** (the same mechanism as the trial): the mandate is authorised now with the ₹5 auto-refunded token, and the first debit runs after the free period [S4]. |
| Authorisation amount | With a future `start_at` and no upfront amount, the authorisation transaction is **₹5, auto-refunded** [S4]. `addons` on creation are an **upfront amount collected in the authorisation transaction** [S33]. Whether an offer changes the authorisation amount is **not documented**. | Every coupon flow keeps a future `start_at`, so the authorisation stays ₹5. **Assumption (validate)** in test mode: an offer does not alter the ₹5 token and is applied from the first real debit. |
| Add-ons / negative add-ons | Add-ons are **positive one-time amounts** added to the next invoice; creating one fails on UPI-authorised subscriptions [S26]. **No documented negative add-on**; Razorpay's discount mechanism is offers [S26][S29]. | Add-ons are **not** used for discounts. |
| Refunds API | `POST /v1/payments/:id/refund` with an optional `amount` (**full or partial**), `speed` `normal` (5–7 working days) or `optimum` (instant via IMPS/NEFT/UPI, falls back to normal; `speed_processed` reports what happened), `notes`, and **idempotent** variants. Refunds go back to the original method (the VPA for UPI). Normal refunds are **not possible for payments older than 6 months**. Gateway fees and their GST are **not reversed**; instant refunds carry a fee. Status `processed` (final) or `failed`. Webhooks `refund.created`, `refund.processed`, `refund.failed`. [S34][S35][S36] | Refunds are an admin RPC that calls the API with an idempotency key; state comes from webhooks + fetch (the §10.1 "event as trigger, API as truth" rule). Each refund costs the PO the original fee. |
| GST on discounts | A discount given **before or at the time of supply and recorded on the invoice** reduces the taxable value (CGST Act s.15(3)(a)); GST is charged on the value **after** the discount. A refund or post-supply reduction of an issued tax invoice needs a **credit note** (s.34), declared no later than **30 November after the end of the financial year** (or the annual-return date, if earlier). Reports say a 2026 amendment relaxes the post-sale-discount conditions from about 1 Nov 2026 (**Unconfirmed** commencement). [S37] | The coupon discount is a **line on our own tax invoice** (`saas_invoices`), and GST is computed on the discounted taxable value. A refund of an invoiced charge creates a **credit note** in its own FY series. |

### 14.2 Coupon types and semantics

All money is integer paise, currency `INR` only, and every discount is defined on the **GST-exclusive base amount** (PO-20), never on the GST-inclusive debit.

| `kind` | Meaning | Allowed `duration` | Provider mechanism (§14.4) |
|---|---|---|---|
| `percent` | `percent_bp` off the base (1–9,900 bp; 100 % is not allowed, use `free_cycles`) | `once`, `repeating` (N cycles), `forever` | Razorpay **flat** offer, amount precomputed by us |
| `amount` | `amount_off_paise` off the base (must leave a debit > ₹1 after GST) | `once`, `repeating`, `forever` | Razorpay **flat** offer |
| `free_cycles` | N whole billing cycles at 100 % off (1–12) **after** the trial | `repeating` (= N) | Deferred `start_at` |
| `trial_extension` | X extra trial days (1–90); the trial plan (AI preview) continues | `once` | Deferred `start_at` |
| `uat` | 100 % off **until a fixed date** (`free_until`, the planned UAT exit), plus optional entitlement grants (§14.8) | until `free_until` | Deferred `start_at` (or `comp_until` fallback, §14.8) |

Duration semantics (as Stripe and Razorpay use them): **`once`** = the first charged cycle only; **`repeating`** = the first N charged cycles; **`forever`** = every cycle of this subscription (not carried to a new subscription unless §14.6 says so). Cycles are counted per **provider subscription**, starting at its first charged cycle.

**Constraints (all columns, enforced server-side):**
- Redemption window `valid_from`/`valid_to` (IST). It governs **new redemptions only**; a redemption already applied runs its full duration (§14.6).
- `max_redemptions` (global, per coupon) and per code; `max_per_owner` (default 1) and `max_per_tenant` (default 1). Counts include **reserved** redemptions so two concurrent checkouts cannot both take the last slot.
- `first_subscription_only` (default **true** for marketing and UAT coupons): the owner and the tenant must never have had an applied redemption or a charged subscription before. This is the same "one trial per owner" identity as SUB-D5.
- Applicability: `coupon_applicability` rows by `plan_id`, `plan_price_id` or `billing_model`. v2.0 allows only `flat_recurring` prices (the Standard plan). Metered products such as the future AI Voice Receptionist need a credit or free-units design at their launch (kind `credit` is reserved, not built).
- `min_base_amount_paise` (optional).
- **Stacking: one coupon per subscription, no stacking** (a partial unique index on live redemptions per tenant). A trial extension is a coupon too, so it does not stack with a discount. A platform-admin **override** (§8.1 `extend_trial`, `comp_until`) is not a coupon and can still be used.

### 14.3 Data model (additions to §7.1)

| Table | Key columns | Notes |
|---|---|---|
| `coupons` (a campaign) | `id`, `name`, `purpose` (`marketing`/`uat`/`goodwill`/`partner`), `kind`, `percent_bp`, `amount_off_paise`, `free_cycles`, `trial_extra_days`, `free_until`, `duration` (`once`/`repeating`/`forever`), `duration_cycles`, `currency` (check = 'INR'), `valid_from`, `valid_to`, `max_redemptions`, `max_per_owner` (1), `max_per_tenant` (1), `first_subscription_only`, `min_base_amount_paise`, `grant_entitlements` (jsonb list of `{key, enabled, limit_value}`; `uat` only), `status` (`active`/`paused`/`archived`), `created_by`, `created_at` | **CHECK constraints per kind** (exactly the fields of that kind are set; `percent_bp` 1–9900; `free_cycles` 1–12; `trial_extra_days` 1–90; `free_until` ≤ `valid_to` + 12 months; `duration_cycles` required iff `repeating`). Never deleted; `archived` instead. |
| `coupon_applicability` | `coupon_id`, `plan_id` / `plan_price_id` / `billing_model` (one of them) | Empty set = no plan (fail closed). |
| `coupon_codes` | `id`, `coupon_id`, `code` (`citext`, **UNIQUE**, stored normalised: upper case, no spaces or hyphens), `batch_id`, `single_use` (bool), `max_redemptions` (null = campaign limit), `assigned_email` (optional; UAT invites), `status`, `expires_at`, `created_at` | Many codes per campaign. Case-insensitive lookup. **Generated batches** use 12 characters of Crockford base32 (no `I L O U`; ~60 bits), optional readable prefix (`UAT-…`), shown with hyphens for reading. Vanity codes (e.g. `LAUNCH20`) are allowed only for `marketing` campaigns with a `max_redemptions`. |
| `coupon_provider_offers` | `coupon_id`, `plan_price_id`, **`supply_type`** (`intra`/`inter`), `provider`, `provider_offer_id` UNIQUE, `offer_amount_paise` (flat), `redemption_type`, `cycles`, `registered_by`, `verified_at` | Only for `percent`/`amount`. **One Razorpay offer per (coupon, price, supply type)**: UNIQUE (`coupon_id`, `plan_price_id`, `supply_type`). Checkout picks the row from the billing-profile state (same state as the supplier → `intra`, otherwise `inter`). (Review addendum 4, fix 1.) |
| `coupon_redemptions` | `id`, `coupon_id`, `coupon_code_id`, `tenant_id`, `owner_user_id`, `plan_price_id`, `provider_subscription_id`, `channel` (`checkout`/`admin`), `applied_by`, `status` (`reserved`/`applied`/`ended`/`released`/`forfeited`/`revoked`), `reserved_until`, `discount_base_paise` (per discounted cycle), `cycles_total`, `cycles_used`, `free_until`, `start_at_shift` (interval), `applied_at`, `ends_at`, `reason`, `version` | **Partial unique index** `(tenant_id) where status in ('reserved','applied')` = no stacking. FKs restrict tenant deletion (statutory survivor while referenced by an invoice; §6.6 table gains this row with 72 months). Written only by SECURITY DEFINER RPCs. |
| `saas_refunds` | `id`, `tenant_id`, `saas_payment_id`, `provider_refund_id` UNIQUE, `amount_paise`, `speed_requested`, `speed_processed`, `status` (`requested`/`processed`/`failed`), `reason_code` (`uat_tester`/`double_debit`/`cancel_race`/`goodwill`/`other`), `reason`, `requested_by`, `idempotency_key` UNIQUE, `credit_note_id`, `created_at`, `processed_at` | Survives purge (money record, 72 months). |
| `saas_invoices` (changed) | adds `doc_type` (`invoice`/`credit_note`), `gross_paise`, `discount_paise`, `discount_label` (coupon name, **not** the code), `coupon_redemption_id`; `taxable_paise = gross − discount` | Credit notes are rows with `doc_type = 'credit_note'` and `credit_note_of` (already in §7.1). |
| `saas_invoice_sequences` (changed) | key becomes (`fy`, `series`) with series `INV` and `CN` | GST needs a consecutive, unique series per FY for credit notes too. |

`subscription_events` gets the types `coupon.reserved`, `coupon.applied`, `coupon.released`, `coupon.cycle_used`, `coupon.ended`, `coupon.forfeited`, `coupon.revoked`, `refund.requested`, `refund.processed`, `refund.failed`, `credit_note.issued`. Every `platform.*` call writes `platform_audit_log` (§8.1 actor rule).

**RLS:** `coupons`, `coupon_codes`, `coupon_applicability` and `coupon_provider_offers` have **no tenant access** (codes are never listable). Owner/admin can SELECT their own `coupon_redemptions` through a view that hides `coupon_code_id` and the code, and their own `saas_refunds`.

**Management:** SQL RPCs first (runbook, §8.1): `platform.create_coupon(...)`, `platform.generate_codes(coupon, count, prefix, single_use, assigned_emails[])` (returns the codes once, for CSV export), `platform.register_provider_offer(coupon, plan_price, supply_type, offer_id, amount, type, cycles)` (refuses an amount that differs from the computed one for that supply type), `platform.set_coupon_status`, `platform.apply_coupon_to_tenant(tenant, code, reason)`, `platform.revoke_redemption(id, reason)`, `platform.refund_payment(payment, amount_paise, speed, reason_code, reason)`. The **Coupons & refunds** screens arrive in V2-13c (SUB-COUPON-06).

### 14.4 How a coupon maps onto Razorpay (Recommendation)

| Option | Assessment |
|---|---|
| **(A) Hybrid (Recommended):** free time = **defer `start_at`**; percentage and fixed discounts = **Razorpay flat offer** linked with `offer_id` at creation; **our `saas_invoices` show the discount line** and are the tax invoice | Uses each provider mechanism only where it is documented to work. The ₹1 floor does not matter because 100 % cases never use offers. Free periods produce no debit, no tax invoice and no fee. |
| (B) A discounted Razorpay plan per coupon | Works only for `forever`. `once`/`repeating` would need a plan switch, which UPI and eMandate subscriptions refuse [S25]. Creates plan clutter. **Rejected** except as a manual fallback for a `forever` partner price. |
| (C) Negative add-ons | Not supported or documented [S26]. **Rejected.** |
| (D) Charge full price and refund the difference | Refund fee lost, a credit note per cycle, and the clinic sees a full debit first. **Rejected** for routine discounts (it is the exception path, §14.7). |

**Why the offer amount is always flat and computed by us:** a Razorpay percentage would be taken on the GST-inclusive amount (176882 paise), with undocumented rounding, while GST law needs the discount on the taxable value. So `platform.create_coupon` computes, per price: `discount_base` (half-up to the paisa), `taxable = base − discount_base`, GST on `taxable` for **both** CGST+SGST and IGST, and `offer_amount = 176882 − discounted_total`. Half-up rounding of CGST and SGST separately can make the two totals differ by a paisa (5, 15, 25, 30, 40, 50 % and others; at **50 % off**: IGST ₹749.50 + ₹134.91 = **₹884.41**, CGST ₹67.46 + SGST ₹67.46 = **₹884.42**). So the RPC computes **both** totals and offer amounts, and the coupon needs **one registered Razorpay offer per supply type** (`intra` and `inter`) for each price before `set_coupon_status` can enable it (when the two amounts are equal, the same Dashboard offer may be registered twice). Checkout picks the offer from the billing-profile state. *Superseded (review addendum 4, fix 1):* "refuses the coupon if the totals differ".

**Worked example (20 % off for 3 months):** base ₹1,499.00 − discount ₹299.80 = taxable ₹1,199.20; CGST 9 % ₹107.93 + SGST 9 % ₹107.93 (or IGST ₹215.86) = **₹1,415.06** debited; Razorpay flat offer **₹353.76** (35376 paise), redemption "limited cycles = 3", **On Payment Failure = block** (never debit more than the clinic was promised; **Assumption (validate)** in test mode what "block" means for a scheduled renewal). Cycle 4 onwards: ₹1,768.82.

**Free cycles and trial extension:** `start_at = trial_end + N months` (IST calendar months at 10:00, same anchor rule as §4) or `trial_end + X days`. **UAT codes:** `start_at = max(trial_end, free_until)`, so a tester admitted less than 14 days before `free_until` keeps the full trial and converts at its end (review addendum 4, fix 9). The mandate is authorised at signup with the ₹5 token exactly as today, debits begin on the shifted `start_at`, and the T-3/T-1 pre-debit notices (§6.3) name the first debit date and the full amount. **Assumption (validate):** the maximum future `start_at` Razorpay accepts for UPI and card mandates (UAT codes may defer by several months; if capped, use the `comp_until` fallback in §14.8).

**State and entitlements during a coupon-funded period (no new status):**
- `trial_extension`: the tenant stays `trialing`; `trial_end` moves; the trial plan (AI preview) continues.
- `free_cycles` / `uat`: at the original `trial_end` the lifecycle tick moves `trialing → active` with `current_period_start = trial_end`, `current_period_end = start_at`, and `funded_by = 'coupon'`; `access_ends_at = start_at + pending_charge_buffer` (§6.2, a charge is scheduled). Entitlements are the **paid plan's** (PO-25: the AI preview ends with the trial), plus the coupon's `grant_entitlements`, which are written as `tenant_entitlement_overrides` with `expires_at = free_until` (UAT only).
- The access rule (§6.2) is unchanged: it still reads only timestamps.

### 14.5 Application flow

1. **Entry points.** (a) The owner types a code at `/onboarding/billing` step 2 (before the subscription is created) or on the re-purchase page. (b) A UAT invite link pre-fills the code (`?code=`), but the code is still validated server-side. Codes are bearer secrets: the page reads the parameter once and strips it with `history.replaceState`, `/onboarding` sends `Referrer-Policy: no-referrer`, and request logging excludes query strings on that route. (c) A platform admin applies a code to a tenant (`platform.apply_coupon_to_tenant`).
2. **Preview (no reservation).** `features/subscriptions/commands.ts` → `validateCoupon(code)`: server-side only, membership-bound (owner of the tenant being onboarded), rate-limited (**5 attempts per 15 minutes per user and per IP, 20 per day per tenant**, via the P1 rate limiter). It returns a description ("3 months at ₹1,199.20 + GST, then ₹1,499 + GST") and the first debit date and amount. **Any failure returns the same message** ("This code can't be used") except "You have already used this offer", which is shown only to the owner who used it. The client never computes a price.
3. **Reserve and create.** In "Start free trial", one transaction: lock the coupon and code rows, re-check every constraint (window, counts including reservations, owner/tenant history, applicability, status), insert `coupon_redemptions(status='reserved', reserved_until = now + 60 min)`, then call `createSubscription(provider_plan_id, start_at = shifted, offer_id = mapped or null, notes = {tenant_id, redemption_id})`.
4. **Apply.** The checkout signature (§5.1) or `subscription.authenticated` webhook moves the redemption to `applied` in the same transition RPC as T1. The `subscriptions.expire_unauthenticated` job (§5.1) moves stale reservations to `released`, which frees the slot.
5. **Each charge.** `billing.sync_subscription` compares the captured amount with the expected amount (coupon cycle → discounted total; otherwise full). It increments `cycles_used` and ends the redemption after the last discounted cycle. **A mismatch** (offer not applied, or applied too long) **alerts the PO** (P1-25), the invoice is written from the **captured** amount with taxable value back-calculated (so the invoice always equals the debit), and the admin corrects it (refund the difference, or delete the offer).
6. **Admin on an existing tenant.** Before checkout: the redemption is attached as `reserved` (channel `admin`) and used at checkout. After the mandate is authorised: the provider subscription cannot take a new `start_at` or, for UPI, an offer [S25][S31], so the admin action creates a **"Re-confirm AutoPay to apply your offer"** task for the owner: a new subscription with the coupon from the current period end (or trial end), and the old one cancelled at cycle end, exactly as §8.2. For a card subscription that is `active`, linking the offer through the Update API at cycle end is allowed but not used in v2.0 (one mechanism for all methods, as §8.2).

**Mandate behaviour when the first N cycles are free:** the mandate is authorised at signup with AFA and the ₹5 token, is dormant through the trial and the free cycles, and the first presentation is the shifted `start_at`. The pre-debit alert from the issuer (≥ 24 h, §3.1) and our own T-3/T-1 notices precede it. `mandate_max_paise` is the full charge amount, so discounted debits are always within it.

**Invoice presentation:** each charged cycle gets one `saas_invoices` row: "Standard plan, 24 Dec 2026 – 23 Jan 2027: ₹1,499.00; Discount (Launch offer, 2 of 3): −₹299.80; Taxable value ₹1,199.20; CGST 9 % ₹107.93; SGST 9 % ₹107.93; Total ₹1,415.06". The **code itself is never printed** (codes are bearer secrets). Free periods produce **no tax invoice** (no consideration, no debit); the billing page shows "Free until 24 Feb 2027 (UAT offer)", and `subscription_events` records it. **Assumption (validate), Claude-researched:** a free period given to an unrelated customer is not a taxable supply, so no invoice is required (Schedule I deems supplies without consideration taxable only between related or distinct persons).

### 14.6 Lifecycle interactions

| Event | Rule |
|---|---|
| Owner **cancels** during a coupon period | Normal R5/§5.3 rules. A free period that has started (status `active`, `funded_by = coupon`) keeps access until `current_period_end` (= `start_at`) with **no buffer** (nothing is pending, because the provider subscription is cancelled). The redemption becomes `forfeited` for the remaining cycles. |
| Owner cancels during the **trial** with a free-cycles or UAT coupon | The free period has not started, so access ends at `trial_end` exactly (§5.3) and the redemption is `forfeited`. **Recommendation:** the cancel screen states this. |
| **Resume** during the trial, or **re-purchase** after expiry | Resume during the trial re-creates the subscription (§5.3) and **carries the same redemption** (same shifted `start_at`, same offer). Re-purchase after expiry does **not** revive a forfeited redemption; a new eligible code may be used (`first_subscription_only` codes are not eligible). |
| **Change payment method** (new subscription, §8.2) | Free time not yet consumed carries over (new `start_at` = the old one). A `forever` offer carries (same `offer_id`). A `repeating` offer carries only if an offer with exactly the remaining cycles is registered; otherwise the remaining discounted cycles are **forfeited** and the UI warns before the switch (**Risk (low)**, accepted for v2.0). |
| Coupon **expires** (`valid_to`) or is **paused/archived** mid-subscription | No effect on applied redemptions. New redemptions are refused. The Razorpay offer's own "Expires On" is set **at least `valid_to` + the longest duration**, because whether an expired offer stops applying to linked subscriptions is **Unconfirmed**; reconciliation (step 5) catches any surprise. |
| Admin **revokes** a redemption (abuse) | `percent`/`amount`: `DELETE /v1/subscriptions/:sub_id/:offer_id`, effective at cycle end [S32]. Free time: cannot be shortened on the provider without a re-mandate, so revocation either leaves the period running or ends access with an admin force-expire (SQL RPC, reason recorded). |
| Past due / halted during a discounted cycle | Unchanged §6.2 rules. A cycle counts as used only when charged. |
| Archive, purge | Redemptions referenced by invoices survive purge with the invoices (72 months, §6.6); others are deleted with the tenant. |

**Abuse prevention (Recommendation):** generated codes have ~60 bits of entropy and single use; vanity codes need a campaign cap; uniform error messages and rate limits stop enumeration; `first_subscription_only` uses the SUB-D5 owner identity (auth user, verified email, normalised phone) plus a soft signal from the masked mandate (same VPA or card network + last 4 seen on a previous tenant → admin review, not an automatic block); per-owner and per-tenant caps; all redemptions are visible in the admin tenant timeline. **Risk (low, accepted):** a determined user with new emails and a different UPI ID can get a second first-subscription offer.

### 14.7 Refunds (admin, exception path)

- **Flow:** `platform.refund_payment(saas_payment_id, amount_paise, speed default 'normal', reason_code, reason, p_actor)` checks: the payment is captured, `amount ≤ captured − already refunded`, the payment is younger than 6 months (otherwise the RPC refuses and the runbook says to pay out manually). It inserts `saas_refunds(status='requested', idempotency_key)` and enqueues a job that calls the **idempotent** refund API. `refund.processed` / `refund.failed` webhooks (and a fetch, §10.1) settle the row; failures alert the PO.
- **Access:** a refund **never changes access**. Ending access is a separate admin force action with its own reason.
- **GST credit note:** a refund of a payment that has a `saas_invoices` row issues a **credit note** (`doc_type = 'credit_note'`, series `CN/<FY>/…`, `credit_note_of` = the invoice), computed from **that invoice's own lines**, never from the plan price: a **full** refund copies the original taxable value and each tax line exactly, with signs reversed; a **partial** refund uses the invoice's own ratio (taxable = refund × invoice taxable ÷ invoice total, half-up; tax = refund − taxable, split CGST/SGST or IGST like the original); the **final** credit note against an invoice takes the remainder of each line, so the credit notes for an invoice never add up to more than it (review addendum 4, fix 2; the earlier "refund × base ÷ charge" gave ₹749.51 taxable for a full refund of an ₹884.42 invoice instead of ₹749.50). It must be declared by **30 November after the FY ends** [S37]; `billing.reconcile` alerts on any credit note still unreported 30 days before that date (GSTR-1 reporting itself is manual in v2.0). The ₹5 authorisation token is refunded by Razorpay itself and never invoiced, so it needs nothing. A charge that raced a cancellation (§6.3) uses this same path automatically with `reason_code = 'cancel_race'`.
- **Reconciliation:** the daily `billing.reconcile` also fetches refunds for payments with `saas_refunds` rows in `requested` and for payments whose provider `amount_refunded` differs from our sum (a refund made in the Razorpay Dashboard by hand is imported and alerted, so the ledger stays complete).
- **Audit:** `platform_audit_log` (actor, channel, amount, reason) and `subscription_events` (`refund.*`, `credit_note.issued`).
- **Costs (Fact):** gateway fees and their GST are not reversed on a refund; instant (`optimum`) refunds carry an extra fee [S35][S36].

### 14.8 UAT: coupons first, refunds as the exception (Recommendation)

The UAT stage (after all of v2 is built, on free tiers, ruling R2) gives real clinics free use in exchange for testing. **Use `uat` coupons, not charge-and-refund**, because:
- no debit means **no tax invoice, no credit note and no GSTIN dependency during UAT** (live charging still needs the GSTIN, §4);
- no gateway fee is lost per tester per month (refunds do not return fees);
- testers still go through the **real mandate flow** (₹5 token), so UAT tests signup, PWA checkout and webhooks end to end, and conversion at UAT exit is automatic.

**UAT coupon defaults:** one campaign `purpose = 'uat'`, `kind = 'uat'`, `free_until` = the planned UAT exit date (PO sets it), **single-use generated codes** with `assigned_email` per tester clinic, `first_subscription_only = true`, `grant_entitlements` = `ai.scribe` with **1,500 drafts per IST calendar month** (the period of the `ai.scribe.monthly_drafts` key; the 14-day trial itself keeps PO-21's 1,500 for the whole trial) until `free_until` (the owner AI opt-in still applies; ruling R4). **Cost ceiling (Assumption, AI_STRATEGY §5):** about ₹0.15 per draft → at most about ₹225 per tester clinic per month, about ₹2,250 per month for 10 tester clinics, bounded by the Vertex project quota and the GCP budget alert. Late admissions: `start_at = max(trial_end, free_until)` (§14.4). Testers see "Free during the pilot until <date>, then ₹1,499 + GST per month; cancel anytime".

**Fallback if Razorpay live mode (KYC) is not ready at UAT start, or the future `start_at` is capped:** admit testers with `comp_until = free_until` and **no mandate** (`incomplete` + comp = `full`, §6.2). At UAT exit they go through the normal checkout (with the trial already consumed: immediate start). This tests less of the payment path, so it is the fallback, not the default.

**UAT exit checklist (feeds the paid-launch gate, roadmap G7 / §17.2):** GSTIN in `platform_settings`; Razorpay live webhook verified; every `uat` redemption's first debit date and amount listed; T-3/T-1 notices verified on a tester; UAT campaign set to `paused` (no new testers redeem after exit); any tester who should not convert cancelled before the first debit; **G7 passed at least 5 days before the earliest `free_until`** (before the T-3 notices go out), or the slip runbook below completed.

**If paid launch slips (review addendum 4, fix 4).** `uat` codes fix `start_at = free_until` at signup and UPI subscriptions cannot be updated [S25], so a G7 slip (no GSTIN, Supabase Pro not upgraded, UAT extended by roadmap §9.1 trigger 5) would otherwise debit testers automatically, possibly with GST charged and no GSTIN. **Rule: no debit may run without a GSTIN in `platform_settings`.** If G7 will not pass ≥ 5 days before the earliest `free_until`, the PO runs the **slip runbook before T-3** (SUB-COUPON-08): (1) grant `comp_until` = the new date to each affected tenant; (2) cancel each affected provider subscription before its first debit (reason `uat_slip`; access continues through comp); (3) at paid launch the owners re-confirm AutoPay (normal checkout, trial already consumed). Alternative: issue the owner "Re-confirm AutoPay" task (§14.5 step 6) with a later `start_at`. A tester debited anyway is refunded in full (`reason_code = 'uat_tester'`).

**When to refund during UAT:** only for a tester who was charged by mistake (code not applied, double debit, a debit after the planned exit that the PO decides to waive). Full refund, `reason_code = 'uat_tester'`, credit note as above.

### 14.9 Tests

| Layer | Cases |
|---|---|
| DB (pgTAP, time travel with `p_now`) | Kind CHECKs; normalised `citext` code uniqueness (`uat-ab12` = `UATAB12`); no stacking (second live redemption fails); global, per-code, per-owner and per-tenant caps **including reservations** under two concurrent sessions; `first_subscription_only` refusal after a charged subscription; window boundaries in IST; flat-offer computation per supply type: 20 % example = 141506 paise for both; **50 % example = 88442 paise `intra` and 88441 paise `inter`**, and the coupon cannot be enabled until both offers are registered; unique (`coupon_id`, `plan_price_id`, `supply_type`); **credit notes for an invoice sum exactly to it** (full refund of 88442 → taxable 74950, CGST 6746, SGST 6746; two partials + final remainder); **late UAT admission** (`free_until` < `trial_end`) → `start_at = trial_end`. **Lifecycle:** trial + 2 free cycles → `trialing` until trial_end, `active` (`funded_by=coupon`) until `start_at`, locked at `start_at + buffer` if no charge, `active` after charge; trial extension keeps `trialing` and AI preview; cancel during the free period → locked at `start_at` with no buffer; cancel during trial with free cycles → locked at `trial_end`; UAT grant override expires at `free_until`; expired coupon does not affect an applied redemption. **Security:** tenants cannot SELECT coupons or codes; `authenticated` cannot call `platform.*` coupon or refund RPCs; owner sees only their own redemption view. |
| Pure unit | `couponPricing(price, coupon)` table: percent, amount, once/repeating/forever, rounding half-up, ₹1 floor refusal; per-supply-type totals (50 % → 88442 / 88441); credit-note split from the invoice's own lines (full = exact reversal; partial by the invoice's ratio; final = remainder; sum of credit notes = invoice, CGST/SGST and IGST). |
| Webhook contract | Fixtures for a charge with an offer (discounted amount), a charge without the expected offer (mismatch alert + invoice from captured amount), `refund.processed`, `refund.failed`, a Dashboard-made refund imported by reconcile, replay of the same event ID. |
| E2E (fake provider, `TEST_NOW`) | Signup with a free-cycles code → trial → free period → first discounted charge → discount ends → full charge, with invoices checked line by line; rate limit after 5 wrong codes; uniform error message; admin applies a code after mandate → owner re-confirm task → new subscription; admin partial refund → credit note PDF row. |
| Razorpay test mode (staging, manual checklist) | Create a flat offer in the Dashboard; subscription with `offer_id` and future `start_at`: **authorisation is ₹5** and the first debit is discounted; offer cycles end on time; "On Payment Failure = block" behaviour; offer `Expires On` passed while linked; UPI update-with-offer refused; deferred `start_at` several months out accepted (find the cap); normal and `optimum` refund, partial and full; refund webhooks delivered. |

### 14.10 Acceptance criteria

1. A code is accepted or refused **only by the server**; a tampered client price or code state has no effect (test).
2. No subscription ever has two live redemptions; caps hold under concurrency (pgTAP).
3. For every charged cycle, `saas_invoices.total_paise` equals the captured amount, and `taxable = gross − discount` with GST on the taxable value; the code never appears on an invoice.
4. Free periods produce no debit and no tax invoice; the mandate is authorised (₹5) and the first debit happens on the shifted `start_at` after T-3/T-1 notices.
5. Every refund has a `saas_refunds` row, an audit entry and, when the payment was invoiced, a credit note in the `CN` series; reconciliation detects a refund made outside the app.
6. A UAT tester can sign up with an assigned code, use the product (AI preview with opt-in) until `free_until`, and is debited ₹1,768.82 on the first cycle after it unless they cancelled.
7. The Razorpay test-mode checklist (§14.9) is passed before percentage/fixed coupons are enabled in production (until then `create_coupon` refuses those kinds via a `platform_settings.offer_coupons_enabled = false` switch).
8. No debit runs without a GSTIN in `platform_settings`; a G7 slip is handled by the §14.8 slip runbook before the T-3 notices.

### 14.11 Backlog (track SUB-COUPON)

| ID | Item | Priority | Size | Depends on | Phase |
|---|---|---|---|---|---|
| **SUB-COUPON-01** | Schema and RPCs: `coupons`, `coupon_applicability`, `coupon_codes`, `coupon_provider_offers`, `coupon_redemptions`, `saas_refunds`; `saas_invoices` discount and `doc_type` columns; `(fy, series)` sequences; kind CHECKs, no-stacking index, caps with reservations; `platform.create_coupon` (with per-supply-type flat-offer computation; both `intra` and `inter` offers required before enable), `generate_codes`, `register_provider_offer`, `set_coupon_status`, `apply_coupon_to_tenant`, `revoke_redemption`; RLS; runbook snippets; pgTAP | P1 | M | SUB-01 | V2-13b |
| **SUB-COUPON-02** | Checkout redemption: `validateCoupon` (rate limits, uniform errors), reserve → apply → release, deferred `start_at` for `free_cycles`/`trial_extension`/`uat`, `funded_by = coupon` transition in `lifecycle_tick`, UAT entitlement grants as overrides, resume/re-purchase/method-change carry rules, admin-applied re-confirm task | P1 | M | SUB-COUPON-01, SUB-03, SUB-04 | V2-13b |
| **SUB-COUPON-03** | Razorpay offers for `percent`/`amount`: test-mode spike (S) first, `offer_id` at creation (offer chosen by supply type from the billing-profile state), expected-amount check in `sync_subscription`, mismatch alert, offer deletion on revoke; `offer_coupons_enabled` switch | P2 (UAT does not need it; needed only for paid-launch promotions) | M | SUB-COUPON-01, SUB-03 | V2-13b (may slip to after paid launch without blocking anything) |
| **SUB-COUPON-04** | Invoices and credit notes: discount line, taxable after discount, captured-amount fallback, `CN` series, credit-note PDF (moves the §13.1 "credit-note PDF" P2 item into v2.0), 30 Nov reporting reminder | P1 | S | SUB-05, SUB-COUPON-01 | V2-13b |
| **SUB-COUPON-05** | Refunds: `platform.refund_payment` (idempotent API call, normal/optimum, 6-month guard), `refund.*` webhooks, reconcile import of Dashboard refunds, `cancel_race` automation on this path, audit | P1 (UAT exception path) | M | SUB-03, SUB-COUPON-04 | V2-13b |
| **SUB-COUPON-06** | Admin UI: Coupons screen (create campaign, generate and export codes, register offer, pause/archive, redemption list) and Refund action on payment rows, in the platform portal (aal2) | P1 | M | SUB-09, SUB-COUPON-01..05 | V2-13c |
| **SUB-COUPON-07** | Owner UI: code field on `/onboarding/billing` and re-purchase, preview text, billing page "Free until …" / "Discount n of N", re-confirm task banner, cancel-screen forfeiture notice | P1 | S | SUB-08, SUB-COUPON-02 | V2-13b |
| **SUB-COUPON-08** | UAT operations: UAT campaign and assigned single-use codes, invite text, comp fallback runbook, **G7-slip runbook** (comp + cancel before T-3; no debit without GSTIN), UAT exit checklist (§14.8) wired into the paid-launch gate | P1 | S | SUB-COUPON-02, -05, -06 | UAT stage: roadmap **V2-15** (campaign, codes, runbook; before G6) and **V2-16** (exit checklist; before G7) |

Total about **L** (five M, three S; the S spike is inside -03). SUB-COUPON-01/02/04/05/07 are needed for UAT; -03 only for paid-launch promotions.

### 14.12 UAT coupon defaults and PO inputs (not open product decisions)

> Relabelled by review addendum 4 (fix 3), consistent with ruling R6: SUB-D9 and SUB-D10 are **adopted defaults (PO may override)**; SUB-D11 is a **PO operational input** (the UAT exit date), not a product decision. Open product decisions: **PO-25 only**; PO-26 = confirm the Supabase upgrade timing.

| ID | Decision | Default |
|---|---|---|
| **SUB-D9** (adopted default; PO may override) | UAT testers: real mandate at signup (₹5 token, automatic conversion at UAT exit) or no mandate (comp access, checkout at exit)? | **Real mandate** (tests the real payment path; comp is the fallback if Razorpay live mode or a long `start_at` is not available) |
| **SUB-D10** (adopted default; PO may override) | Do UAT testers keep the AI preview (with owner opt-in) for the whole UAT, not only the 14-day trial? | **Yes**, until `free_until` (AI feedback is part of UAT; ends at UAT exit per PO-25's default) |
| **SUB-D11** (PO operational input) | UAT exit date (`free_until`) and whether testers get any free months after exit | **PO sets the date; no extra free months** (a `free_cycles` goodwill code can be issued per tester) |

Percentage/fixed launch promotions need no decision now: they ship behind a switch (SUB-COUPON-03) and the PO creates campaigns when wanted.

---

## 15. Sources (accessed 2026-11-10)

- [S1] Taxmann, "RBI E-Mandate Framework 2026 for Recurring Payments": https://www.taxmann.com/post/blog/rbi-e-mandate-framework-for-recurring-payments/
- [S2] Business Today, "RBI caps recurring payments at Rs 15,000 without OTP under new e-mandate framework" (2026-04-21): https://www.businesstoday.in/personal-finance/news/story/rbi-caps-recurring-payments-at-rs15000-without-otp-under-new-e-mandate-framework-526759-2026-04-21
- [S3] King Stubb & Kasiva, "RBI Consolidates E-Mandate Rules … 2026 Framework": https://ksandk.com/newsletter/rbi-e-mandate-framework/ ; RBI notification index: https://www.rbi.org.in/scripts/NotificationUser.aspx?Id=13374 (full text **not retrieved**; the circular number reported as RBI/CO.DPSS.POLC.No.S56/02.14.003/2026-27 is **Unconfirmed**)
- [S4] Razorpay Docs, "How Subscriptions Work" (authentication amount table: future start, no upfront = ₹5, auto-refunded): https://razorpay.com/docs/payments/subscriptions/workflow/
- [S5] Razorpay Docs, "Subscriptions: supported payment methods" (UPI AutoPay up to ₹1,00,000; UPI Collect deprecated for new AutoPay registrations from 28 Feb 2026): https://razorpay.com/docs/build/llm-docs/payments/subscriptions/supported-payment-methods.md
- [S6] Razorpay Docs, Subscriptions FAQ: https://razorpay.com/docs/payments/subscriptions/faqs?preferred-country=IN
- [S7] Cashfree Docs, Subscription introduction / payment modes: https://www.cashfree.com/docs/payments/subscription/introduction ; https://www.cashfree.com/docs/payments/subscription/payment-modes
- [S8] Cashfree Blog, "UPI AutoPay vs cards for India subscriptions" (fees): https://www.cashfree.com/blog/upi-autopay-vs-cards-india-subscriptions/ (pricing **Unconfirmed** on the official pricing page)
- [S9] Razorpay Docs, Recurring payments interoperability (pause/revoke from UPI apps; merchant must not delete user-paused mandates): https://razorpay.com/docs/payments/recurring-payments/interoperability
- [S10] Paytm Blog, "How to modify, pause or cancel your UPI AutoPay mandates": https://paytm.com/blog/bill-payments/upi-autopay/how-to-modify-pause-or-cancel-your-upi-autopay-mandates-for-full-control/
- [S11] PhonePe PG, "Subscription payments in India: UPI AutoPay vs e-NACH vs cards" (tokenisation for card recurring): https://business.phonepe.com/articles/how-to-accept-subscription-payments-in-india-upi-auto-pay-vs-e-nach-vs-cards
- [S12] The Paypers, "Stripe moves to invite only in India": https://thepaypers.com/payments/news/stripe-moves-to-invite-only-in-india
- [S13] Business Today (2026-03-10), US LLC route to Stripe (states that new Indian registrations stopped in May 2024): https://www.businesstoday.in/amp/impact-feature/story/forming-a-us-llc-to-access-stripe-is-a-legitimate-move-the-tax-compliance-it-creates-is-not-small-519932-2026-03-10
- [S14] PhonePe Developer Docs, AutoPay subscription setup and recurring system flow: https://developer.phonepe.com/payment-gateway/autopay/api-integration/api-reference/subscription-setup ; https://developer.phonepe.com/v1/docs/system-flow-recurring
- [S15] Razorpay API, Cancel a Subscription (`cancel_at_cycle_end`; not allowed before the first cycle; cancelled subscriptions cannot be restarted): https://razorpay.com/docs/api/payments/subscriptions/cancel-subscription/ ; Subscription states: https://razorpay.com/docs/payments/subscriptions/states/
- [S16] Razorpay Docs, Payment Retries (cards and UPI: `pending` on first failure, retries on T+1, T+2, T+3, then `halted`; eMandate retries wait for the previous result; holiday rules): https://razorpay.com/docs/payments/subscriptions/payment-retries/
- [S17] Razorpay Docs, Subscription webhook events: https://razorpay.com/docs/webhooks/subscriptions/
- [S18] Razorpay Docs, Validate and test webhooks (`X-Razorpay-Signature`, HMAC-SHA256, `x-razorpay-event-id`): https://razorpay.com/docs/webhooks/validate-test/
- [S19] Razorpay Docs, Test Subscriptions: https://razorpay.com/docs/payments/subscriptions/test/
- [S20] Razorpay Blog, recurring billing pricing articles (2% + subscription add-on; figures conflict): https://razorpay.com/blog/cheapest-payment-gateway-for-recurring-billing-e-nach-upi-autopay-and-subscription/ ; https://razorpay.com/blog/best-payment-gateway-pricing-saas-india-tco-guide/
- [S21] India Briefing, "GST compliance for SaaS and cloud computing in India": https://www.india-briefing.com/news/gst-compliance-for-saas-and-cloud-computing-in-india-explained-39021.html ; Xflow, "GST on software services": https://www.xflowpay.com/blog/gst-on-software-services (SAC code and inter-state threshold **conflict across sources**)
- [S22] Supabase Pricing (Pro: $25 base; disk $0.125/GB; storage $0.0213/GB; PITR $100/month per 7 days): https://supabase.com/pricing
- [S23] Republic World, "NPCI's new 2026 rules shift recurring debits to off-peak windows": https://republicworld.com/business/upi-autopay-failure-morning-peak-hours-npci-new-rules-2026 (weak secondary source; **Unconfirmed**; no NPCI circular found)
- [S24] KPMG India, "RBI Digital Payments – E-mandate Framework 2026" (15 Jun 2026; framework issued 21 Apr 2026; first transaction needs AFA; issuer alert 24 h before debit): https://kpmg.com/in/en/insights/2026/06/reserve-bank-of-india-rbi-digital-payments-e-mandate-framework-2026.html
- [S25] Razorpay API, Update a Subscription ("subscriptions cannot be updated when payment mode is UPI"; "Emandate subscriptions are immutable post-authentication"): https://razorpay.com/docs/api/payments/subscriptions/update-subscription/
- [S26] Razorpay API, Subscriptions Add-on (one-time amount added to the next invoice; creating add-ons fails for UPI-authorised subscriptions): https://razorpay.com/docs/api/payments/subscriptions/add-on (direct fetch returned 404 on 2026-11-10; content confirmed via search snippets of the same page and https://razorpay.com/docs/api/payments/add-on)
- [S27] TaxGuru, accounts and records under CGST Act s.35–36 and Rules 56–58 (s.36: at least 72 months from the last date of filing the annual return): https://taxguru.in/goods-and-service-tax/accounts-records-maintained-gst-sec-35-36-rules-56-58-cgst-act.html
- [S28] DPDP Rules 2025, Rule 8(3) (one-year retention of personal data, traffic data and processing logs; commencement 18 months after the 13 Nov 2025 notification, about 13 May 2027, **Unconfirmed** against the gazette): Bar & Bench, https://www.barandbench.com/view-point/meity-notifies-final-digital-personal-data-protection-rules-2025 ; https://dpdp.myndsolution.com/wiki/rules/rule-8-time-period-for-specified-purpose-to-be-deemed-as-no-longer/ (returned 503 on 2026-11-10; cited from search results)
- [S29] Razorpay Docs, About Offers (Subscriptions): Flat/Percentage; Single use / limited cycles / Forever; "Offers can only be applied if the chargeable amount after applying the Offer is greater than ₹1"; UPI and cards: https://razorpay.com/docs/payments/subscriptions/offers/
- [S30] Razorpay Docs, Create Subscription Offers (Dashboard fields: redemption type, cycles, validity, Max Usage, On Payment Failure): https://razorpay.com/docs/payments/subscriptions/offers/create/
- [S31] Razorpay Docs, Link an Offer to a Subscription (at creation via `offer_id`; to an existing subscription only in `active` state, effective at cycle end; Standard Checkout only): https://razorpay.com/docs/payments/subscriptions/offers/link/ ; Update an offer (Dashboard, end of cycle): https://razorpay.com/docs/payments/subscriptions/offers/update/ ; API: https://razorpay.com/docs/api/payments/subscriptions/link-offer/
- [S32] Razorpay API, Delete an Offer Linked to a Subscription (`DELETE /v1/subscriptions/:sub_id/:offer_id`; effective at cycle end): https://razorpay.com/docs/api/payments/subscriptions/delete-offer/ ; https://razorpay.com/docs/payments/subscriptions/offers/delete/
- [S33] Razorpay API, Create a Subscription (`offer_id`, `addons` = upfront amount in the authorisation transaction, `start_at`, `total_count`, `customer_notify`, `notes` ≤ 15): https://razorpay.com/docs/api/payments/subscriptions/create-subscription/
- [S34] Razorpay API, Refunds (normal and instant create, idempotent variants, fetch): https://razorpay.com/docs/api/refunds/ ; instant: https://razorpay.com/docs/api/refunds/create-instant/ ; speed: https://razorpay.com/docs/payments/refunds/refund-speed/
- [S35] Razorpay Docs, Refunds (5–7 working days; instant; normal refunds not possible after 6 months; statuses) and FAQs (fees on the original payment not reversed; instant refund fee): https://razorpay.com/docs/payments/refunds/ ; https://razorpay.com/docs/payments/refunds/faqs/
- [S36] Razorpay Docs, Refund webhooks (`refund.created`, `refund.processed`, `refund.failed`): https://razorpay.com/docs/webhooks/refunds/
- [S37] GST on discounts and credit notes: ClearTax, "Post-sale discount under GST": https://cleartax.in/s/post-sale-discount-under-gst ; GSTGyaan, CGST s.34 (credit notes; 30 November time limit): https://gstgyaan.com/section-34-circumstance-for-issue-of-credit-notes-or-debit-notes-its-time-limit-and-contents ; CalcGuru on the 2026 post-sale discount amendment (commencement **Unconfirmed**): https://calcguru.in/?p=9897

---

## Review disposition (independent review, 2026-11-10)

All 19 required changes were checked against the repo and, where external, re-verified online. Each one was **accepted and applied**, with these precisions:

- **#1 trial includes AI:** applied (R3, `standard_trial` plan via `plans.trial_plan_id`, §7.2 resolution order, §11 test).
- **#2 AI keys:** applied (§2, §7.3 now points to `AI_STRATEGY.md` §5.2/§6; `ai.monthly_token_quota` replaced by per-key limits in `plan_entitlements` + AI-track usage; D-1 add-on adopted).
- **#3 add-on billing:** applied and **strengthened**: verification also found that add-ons cannot be created on UPI-authorised subscriptions at all [S26], which rules out option (c) outright. §7.4, `tenant_addons`, SUB-11, SUB-D8.
- **#4 mandate settled:** applied (R4; old Q3/D2 removed; §5.2 kept as rationale).
- **#5 deviations:** applied (SUB-D4, SUB-D5; 0 allowed; grace only for failed debits).
- **#6 retry window:** applied; T+1/T+2/T+3 confirmed [S16]; first-charge grace 4 days or `halted`, whichever is first.
- **#7 purge survivors:** applied (§6.6). Precision: CGST s.36 counts 72 months from the **last date of filing the annual return** (the review's "due date of the annual return" means the same thing); DPDP Rule 8 commencement remains **Unconfirmed**.
- **#8 no PHI links in notices:** applied (§6.3, §6.5, §11).
- **#9 SECURITY DEFINER exposure:** applied (`billing_internal` schema, revokes, `my_*` wrappers, tests).
- **#10 SQL runbook actor:** applied (§8.1 branch and tests).
- **#11 storage and links:** applied (storage policies, share-token revocation, TTL caps, tests). Interaction with prescription verification resolved as SUB-D6 (metadata only, no file).
- **#12 access function:** applied (comp first, `onboarding`, buffer only when a charge is pending).
- **#13 routes:** applied (`/onboarding/clinic`, `/onboarding/billing`). This doc cannot edit `AUTH_REDESIGN.md`; the answer to its "Open question SUB" is recorded in R4 and §13.2 for the coordinator.
- **#14 phase order:** applied with a precision: the roadmap runs V2-11, V2-12 and V2-13 **in parallel** after V2-10 (not strictly in sequence), but the dependency problem the review found is real. New placement: V2-13b and V2-13c after V2-13, before V2-14; platform-admin MFA pulled into V2-13c.
- **#15 PWA checkout:** applied (§5.4, §11 device tests).
- **#16 no human advisers:** applied (PO-supplied facts, Claude-researched defaults marked Unconfirmed, advice optional).
- **#17 labels:** applied ("Configurable defaults", one `SUB-D` list, AI decisions cross-referenced).
- **#18 sources:** applied ([S16] updated, [S24]–[S28] added, [S23] kept Unconfirmed and labelled weak). KPMG does not restate the ₹15,000 figure, so it corroborates only the AFA and 24 h alert points.
- **#19 export protection:** applied (platform encryption at rest only; owner-only access; no admin path; per-export key as P3).

Optional improvements: **all applied** (SUB-09 scope cut and P2 deferrals; `payment_mandates` folded into subscription columns; `features` renamed `entitlement_keys` and `plan_features` renamed `plan_entitlements`; `customer_notify=false` with a test-mode check; email default and WhatsApp opt-in, outside PO-8; one worked example (T0 = 10 Nov → 24 Nov 10:00 IST); SUB-07 required before go-live; test seed helper; webhook payload nulled after 90 days; "Clinic Paper (shadcn/Radix)").

Rejected: none.
