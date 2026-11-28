---
phase: "13B"
roadmap_id: V2-13b
name: SaaS subscriptions & billing
revision: "2026-11-28, first revision (CTO under the PO's delegation; deadline: every phase except go-live done by 6 Dec 2026)"
gate: "G4 (light, per PR) with an adversarial security review (security-sensitive: billing, webhooks, migrations, RLS, auth signup). Two PRs: 13b-i (billing core, 13B-01..05) and 13b-ii (coupons, discounts, credit notes, refunds, 13B-06..07). Per PR: one isolated reviewer (Sonnet) and one adversarial reviewer (Opus), one fix round (13B-08a / 13B-08b). The PO approves the gate, or Claude approves by delegation with the CI run recorded."
requirements: ["V2_MASTER_ROADMAP §12.2 V2-13b (objective, scope, acceptance, tests, evidence)", "SUBSCRIPTIONS_AND_PLANS §4-§8, §10, §11, §14 (SUB-03, SUB-04, SUB-05, SUB-08, SUB-COUPON-01/02/03/04/05/07)", "AUTH_REDESIGN §3.1, §3.3, §4.4, §4.6 (AUTH-07)", "PWA_STRATEGY §6.6, §9.1 spec 9 (PWA-05 lock path, PWA-08)", "PO-20 (₹1,499 + GST = ₹1,768.82), PO-21 (no AI purchase), PO-25 (AI preview ends with the trial), SUB-D3..D7 adopted, SUB-D9/D10 adopted", "Deferred to V2-13b by earlier phases (list in 'Inherited items')"]
plans: ["13B-01", "13B-02", "13B-03", "13B-04", "13B-05", "13B-08a", "13B-06", "13B-07", "13B-08b", "close"]
order: "PR 13b-i: 13B-01 -> 13B-02 -> 13B-03 -> 13B-04 -> 13B-05 -> reviews -> 13B-08a -> push. PR 13b-ii (branched from the 13b-i tip, merged after it): 13B-06 -> 13B-07 -> reviews -> 13B-08b -> push. Sequential, one local stack, one executor at a time."
preconditions: "V2-10 (lib/fy, FY numbering), V2-11 (owner TOTP, requireRecentAuth, AUTH-09 session policy), V2-12 (P1-26 Postgres rate limiter, messaging governance) and V2-13 (purge machinery, audit hardening) merged into feature/v2. If V2-12's limiter is not merged when 13B-06 starts, 13B-06 adds the minimal Postgres limiter table itself in 000185 (recorded deviation) instead of waiting."
migrations: {"13B-01": "000180_billing_provider", "13B-02": "000181_owner_onboarding", "13B-03": "000182_billing_lifecycle", "13B-04": "000183_saas_invoices", "13B-08a": "000184_review_fixes_13b_i", "13B-06": "000185_coupons", "13B-07": "000186_refunds_credit_notes", "13B-08b": "000187_review_fixes_13b_ii", "spare": "000188, 000189"}
migrations_note: "Reserved range 000180-000189. Run `ls supabase/migrations | tail -3` at the start of each plan; if V2-10..V2-13 overran into 000180+, take the next free number inside the range and record it in 13B-NOTES.md. Every migration commit also bumps app/api/ready/expected-migration.ts, the schema snapshot, types/database.ts (npm run db:types), scripts/ci/assert-pgtap-report.mjs (REQUIRED_FILES, FLOOR with arithmetic) and assert-vitest-report.mjs REQUIRED_FILES (09E shared rules)."
new_dependencies: "none. The Razorpay adapter uses fetch + node:crypto (no razorpay SDK: one less supply-chain surface, the REST surface we use is 8 calls). The checkout script is loaded from checkout.razorpay.com at runtime (CSP entry, V2-14 14-01). PDFs reuse @react-pdf/renderer (already a dependency). Contract tests reuse msw (already a dev dependency)."
branch: "v2/phase-13b-saas-subscriptions -> PR into feature/v2 (13b-i); v2/phase-13b-ii-coupons -> PR into feature/v2 (13b-ii)"
---

# V2-13b SaaS subscriptions & billing: plan

## Goal

A clinic owner signs up (email + password + emailed code, Turnstile), creates the clinic, enters a billing profile,
authorises a UPI AutoPay or card mandate (₹5 token, auto-refunded) and gets 14 days of full access. On day 15 at 10:00 IST
₹1,768.82 (₹1,499 + 18 % GST) is debited, a gapless GST invoice is issued, renewals follow monthly, the owner can cancel at
any time (access to the end of the paid period) and access stops by itself, in the database, the moment it ends. A
failed debit gets grace (4 days first charge, 7 renewal) or ends at `halted`. One coupon per subscription (free cycles,
trial extension, `uat`, percent/amount) defers or discounts the debit; a platform refund is idempotent and issues a
credit note. Everything runs locally and in CI against a Fake provider and recorded, locally signed Razorpay payloads:
no test touches the network. Razorpay test mode on staging is a PO checklist, not a CI dependency.

Tracer: 13B-01 proves one vertical slice first: a locally signed `subscription.authenticated` webhook reaches the route,
is deduplicated, enqueues `billing.sync_subscription`, the job fetches the (Fake) provider state and moves a seeded
`incomplete` clinic to `trialing` through one transition RPC, with the event row, audit row and the clinic's access level
`full`, all asserted in one DB test.

## Current state (feature/v2 at c609907a)

| Area | Today | Gap | Plan |
|---|---|---|---|
| Schema | V2-05 built SUB-01/02: `plans`, `plan_prices` (charge 176882 generated), `entitlement_keys`, `plan_entitlements`, `tenant_entitlement_overrides`, `tenant_subscriptions` (mandate columns, `version`), `subscription_events` (append-only), `platform_settings`, `platform_admins`, `platform_audit_log` (000080-000086) | `provider_webhook_events`, `billing_profiles`, `saas_payments`, `saas_invoices`, sequences, coupons, refunds (05-PLAN R-10: create each with its first writer) | 01, 02, 04, 06, 07 |
| Access | `billing_internal.tenant_access_level`, `has_entitlement`, `entitlement_limit`, `start_trial` (service role); `authz.full_tenant_ids` / `billing_tenant_ids`; storage on the full helper; `my_tenant_access`, `my_entitlements` (000083, 000090) | Transitions T2-T8 and the provider-driven T1 | 01, 03 |
| Platform RPCs | `platform.extend_trial`, `set_comp`, `grant_override`, `create_plan_price`, `set_product_availability`, actor rule `private.platform_actor` (000085, R-38) | `extend_trial` does not move the provider's first-charge date (05-09b note); coupon/refund RPCs | 02, 06, 07 |
| Onboarding | `app/(onboarding)/clinic/new` (any signed-in user can create clinics: AD-3 residual), `app/(onboarding)/onboarding/billing` interim page; `enable_signup` false everywhere | `/signup`, billing profile, Start trial, PWA resume | 02 |
| Locked UI | `/billing/locked`, `/billing/locked/staff` functional (05-10b); D-8 hard navigation and `/api/session-status` access level (06-06) | Renew/re-purchase, invoices, styled; spec 9 with billing driving the lock | 05 |
| Jobs | V2-04 claim/runner, pg_cron kick, handlers registry (`lib/jobs/internal/registry.ts`), alerts (`ops.evaluate_alerts`) | `billing.*` handlers and schedules | 01, 03 |
| Email | `lib/email` providers `mailpit`, `resend`, `ses`, `disabled` (PO 2026-11-13: Resend now, SES after go-live) | Billing notice templates | 03 |
| Rate limits | `lib/api/rate-limiter.ts` is in-memory (per instance); V2-12 brings the Postgres limiter (P1-26) | Code validation limits | 06 |

## Decisions (CTO, small; one-line rationale each)

| # | Decision | Rationale |
|---|---|---|
| D-1 | No Razorpay SDK; a fetch adapter over the 8 endpoints used (create/fetch/cancel subscription, fetch invoices, fetch payment, refund, fetch refunds, fetch customer), Basic auth, 10 s timeout, no retries inside a request | Smallest supply-chain surface; jobs already retry |
| D-2 | `FakeBillingProvider` keeps its state in the server process memory, driven by a dev-only control route `POST /api/dev/billing-fake` that exists only when `BILLING_PROVIDER=fake` and the env tier is not production (env schema refuses `fake` in production, as `mailpit`) | No test schema shipped to production; the e2e server is one `next start` process |
| D-3 | `TEST_NOW` server clock override: read only through `lib/billing/clock.ts`, honoured only when `APP_ENV` is `ci`/`e2e`/`local` and compiled to `Date.now()` otherwise (build-time constant + a production-build test) | SUB §11; never reachable in production |
| D-4 | Every owner billing action (start trial, cancel, resume, change method, re-purchase) is a server action that calls the provider, then hands provider truth to `billing_internal.apply_provider_state` through `features/subscriptions/system.ts` (ADR-0005 `features/*/system.ts` allow-list). No client-supplied provider state is ever applied | "Event as trigger, API as truth" (SUB §10.1); ADR-0005 |
| D-5 | One transition RPC, `billing_internal.apply_provider_state(p_tenant, p_snapshot jsonb, p_event_id text, p_now)`, plus `billing_internal.lifecycle_tick(p_now)` for time rules; both guarded by `version` and `from_status`, both write `subscription_events` in the same transaction | One place for T1-T8; idempotent under duplicates and reordering |
| D-6 | The pure `nextState(snapshot, event, now)` in `lib/billing/lifecycle.ts` is the spec; the SQL is checked against the same case table (TypeScript twin, the 09E R-6 parity pattern) | One rule, two implementations, one table |
| D-7 | Signup route is `/signup`; clinic creation stays at the existing `/clinic/new` (AUTH §3.1's `/onboarding/clinic` is a name only; a redirect is added from it) | No churn in tested routes |
| D-8 | `create_clinic_with_owner` is refused for a user who already owns or has owned a clinic that consumed a trial, unless a platform override exists; a user may hold at most one `incomplete` clinic | Closes the AD-3 "unlimited clinics" residual; SUB-D5 one trial per owner |
| D-9 | Owner identity for "one trial per owner" and `first_subscription_only`: `billing_owner_ledger(owner_user_id, email_normalised, phone_normalised, trial_consumed_at, first_charge_at)`; a masked-mandate match on another tenant only raises an admin review flag | SUB §4, §14.6 abuse rules, no automatic blocks on soft signals |
| D-10 | **Public signup is closed while `platform_settings.supplier_gstin` is NULL**, except with a valid `uat` code or a platform comp: a code-less owner sees "Sign-ups open soon" after creating the clinic. A setting `public_signup_open` (default false) must be true *and* the GSTIN present for code-less checkout | "No debit without a GSTIN" (SUB §14.8): a code-less trial would debit on day 15 |
| D-11 | Branch question at onboarding ("Do you have, or plan to open, other branches?") is asked and stored on `billing_profiles.plans_branches`; v2.0 always uses the fixed Subscriptions mode; the ₹749 extra-branch price row is seeded `purchasable = false`. See CTO-1 | Branch screens are v2.1, so no v2.0 clinic can add a branch |
| D-12 | WhatsApp billing notices: the opt-in column and channel switch are built, the channel ships off (`billing_whatsapp_enabled = false`) until the MSG91 `account_billing` template is approved (PO action); email is the default and only live channel at UAT | Template approval is external; email covers every notice |
| D-13 | SaaS invoice PDFs are rendered on demand from the immutable invoice row (no stored file); the row stores the SHA-256 of the canonical render, a golden-file test pins it | Nothing to purge or overwrite; the row is the record |
| D-14 | `saas_invoices` is created in its final shape at once (`doc_type`, `gross_paise`, `discount_paise`, `discount_label`, `coupon_redemption_id`, `credit_note_of`; sequences keyed `(fy, series)`) | Avoids an expand/contract inside one phase |
| D-15 | Percent/amount coupons (SUB-COUPON-03) are built end to end against the Fake provider (offer chosen per supply type, passed at creation, expected-amount check, mismatch alert), behind `platform_settings.offer_coupons_enabled = false`; turning it on needs the PO's Razorpay test-mode checklist (§14.9) | C47 lets -03 slip; building it now costs little and removes a later phase |
| D-16 | Charge-after-cancel (§6.3) in 13b-i raises an alert only; 13B-07 switches it to the automatic `cancel_race` refund | Refunds land in 13b-ii |
| D-17 | Comp on a trialing clinic: `lifecycle_tick` sets the stored status at `trial_end` regardless of comp, so trial AI ends at trial end (05b AI I-3) | Closes the inherited finding |
| D-18 | `start_trial` / checkout refuse a price without `provider_plan_id` in every tier except `BILLING_PROVIDER=fake` (05b AI L-2) | A plan can never be bought without a provider plan |
| D-19 | The checkout modal is Razorpay Standard Checkout as an in-page modal (`handler`, no `callback_url`); the Fake renders a same-shaped modal component under the same `data-testid`s | SUB §5.4; e2e drives the same UI |

## CTO decisions needed (true conflicts with approved docs; default applies if unanswered)

| # | Conflict | Approved source | Recommendation (default) |
|---|---|---|---|
| CTO-1 | Multi-branch clinics on Razorpay Recurring Payments ("two billing modes"), placed in V2-13B by the PO decision of 2026-11-15 (+20-30 % scope) | VERIFICATION_LOG "branch pricing and the two-mode Razorpay billing strategy" | **Defer the Recurring Payments mode to v2.1 with the branch screens.** In v2.0 no clinic can create a second location (branch screens are v2.1, VERIFICATION_LOG 2026-11-15), so the mode cannot be exercised or tested end to end and would add an untestable second payment path before UAT. v2.0 ships the onboarding question (stored), the ₹749 price row (not purchasable) and a `BillingProvider` interface whose method list leaves room for `createRecurringMandate`. Saves about a day against the 6 Dec deadline |

## Inherited items (deferred to V2-13b by earlier phases)

| Item | Source | Plan |
|---|---|---|
| `/signup`, pre-account-hijack guard (`updateUser` + `signOut('others')`), CAPTCHA, uniform response + "account exists" email (A00-3), `enable_signup` on (config as code), 7-day purge of unconfirmed users, per-account verify limiter, login "New clinic? Create an account" link | 01-06-auth brief; 03-PLAN 1252-1254; 03-13 triage | 13B-02 |
| AD-3 unlimited clinics per user | 01-PLAN:115 | 13B-02 (D-8) |
| Send Email hook outage reveals account existence (D L-3) | 03-13 triage | 13B-02: signup answers the same "enter the code" screen on hook failure; verified by a fault test |
| Create `saas_*`, `billing_profiles`, `provider_webhook_events` with their first writer | 05-PLAN R-10 | 01, 02, 04 |
| AI L-2 (no provider plan id), AI I-3 (comp keeps trial AI), A13 (`ai_period` NULL `trial_start` CHECK) | 05b triage/summary | 02 (D-18), 03 (D-17), 03 (CHECK `trial_start` NOT NULL when status = `trialing`) |
| New clinics stuck at `/onboarding/billing` (IND I-1) | 05b summary | 02 |
| `extend_trial` must move the provider first-charge date | 05-09b | 13B-06 (re-confirm task path; SUB §14.5 step 6) |
| Share-token revocation at `expired`; claim-exempt kinds for owner billing notices; cancelled-message status | 05-10a:150-154 | 03 |
| Styled locked pages with renewal; "Coming soon" row; remove "Plan management arrives with billing (V2-13b)" copy | 05-10b, 06-PLAN, 05-12 | 05 |
| PWA-05 spec 9 (billing-driven lock with Today open), exempt cleanups | 06-PLAN, 06-06, 08-PLAN | 05 |
| `requireAccessDestination` throwing `ActiveClinicMembershipEndedError` to the error page on locked/onboarding pages | 06-SUMMARY | 05 |
| Owner-scoped staff list on the locked owner page | 05-12, 05b | 05 (read-only list + "remove" link to the V2-11 staff page, which works while locked for owner/admin billing scope) |
| `resend_invitation` limit (email bombing once clinics are self-serve) | 05b independent review | 13B-02 (if V2-12 did not add it: 3 per invite per hour, 20 per clinic per day, on the Postgres limiter) |

## Shared rules for every plan

The 09E shared rules apply unchanged (`.planning/phases/09E-caching-speed/09E-PLAN.md` § Shared rules): INVOKER STABLE reads
with `search_path = ''` and the tenant checked in the body; SECURITY DEFINER commands with the actor/tenant/permission
guard block and `lock_timeout = '2s'`; routes with session auth, permission, tenant from the session, fixed error bodies,
`private, no-store`, `Server-Timing`, registered in `tests/security/guard-manifest.ts` and `npm run inventory`; registries
bumped in the migration commit; affected-test discovery by grep (authoritative); tests assert real outcomes; e2e owns its
data; `page.clock` and `TEST_NOW`, never sleeps; axe at 360/820/1280; V2-06 parts only. Additionally:

- **Billing functions:** everything that decides access or a transition takes `p_now` and lives in `billing_internal`
  (REVOKE from `public`, `anon`, `authenticated`; service role only). Clients get only caller-bound `public.my_*` reads.
  pgTAP asserts the grants for every new function in `grants.test.sql`.
- **Atomic commands:** each billing command is one transaction with its `subscription_events` row, its
  `platform_audit_log` row when an admin acts, and its outbox/job rows; idempotent by `client_request_id` or provider
  event id; stale writes refused by `version` (`ROW_CHANGED`, the 09E R-19 code).
- **Provider truth:** a transition is applied only from a provider fetch (or the Fake's state) inside a job or a
  server action, never from a webhook body or client payload alone. `notes.tenant_id` is cross-checked against the
  stored `provider_subscription_id`.
- **Money:** integer paise, `INR` only, half-up per line; `lib/billing/tax.ts` is the only tax code in TypeScript and
  `billing_internal.tax_split()` its SQL twin, both tested against one case table (incl. 149900 → 13491/13491 or 26982;
  50 % → 88442 intra / 88441 inter; 20 % → 141506).
- **Time:** IST boundaries through `lib/datetime` and `Asia/Kolkata` in SQL; anchors at 10:00 IST (SUB §4).
- **Live convergence:** billing transitions bump the `billing` and `settings` domain versions (09E R-18) so an open
  device learns the access change by signal or the 12 s heartbeat; `/api/live/state` already carries the access level.
- **No network in tests:** the Razorpay adapter is exercised only through msw handlers with recorded, scrubbed fixtures
  under `tests/fixtures/razorpay/`; webhooks are signed in-test with `RAZORPAY_WEBHOOK_SECRET=test_whsec_local`; the
  vitest network guard stays on.
- **Notices:** no notice body or template variable contains a storage host, a signed URL, `token=` or a coupon code
  (one regex spec over every template).
- **Security-sensitive files** (adversarial review covers every one): `supabase/migrations/00018*`,
  `app/api/webhooks/razorpay/**`, `lib/billing/**`, `features/subscriptions/**`, `app/(auth)/signup/**`,
  `features/auth/signup*.ts`, `lib/jobs/internal/handlers/billing-*.ts`, `app/api/dev/billing-fake/**`, `lib/env.ts`
  changes, `lib/auth/sensitive-actions.ts` changes, every `platform.*` coupon/refund RPC.

## Plans

### 13B-01 Provider seam, Fake, Razorpay adapter, webhook ingress and the sync job (tracer) · M · migration 000180_billing_provider

Goal: provider events and owner actions can move a clinic's subscription only through provider truth, once, in order-free
fashion.

Files: `supabase/migrations/000180_billing_provider.sql`; `supabase/tests/database/billing_provider.test.sql`;
`lib/billing/{provider.ts,razorpay.ts,fake.ts,clock.ts,lifecycle.ts,snapshot.ts}`; `app/api/webhooks/razorpay/route.ts`;
`app/api/dev/billing-fake/route.ts`; `lib/jobs/internal/handlers/billing-sync.ts` (+ registry); `lib/env.ts`
(`BILLING_PROVIDER` `razorpay|fake`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`; production refuses
`fake` and `rzp_test_`); `.env.example`; `tests/fixtures/razorpay/*.json`; `tests/billing/{razorpay-adapter,webhook-route,lifecycle-next-state,fake-provider}.spec.ts`.

1. Tracer (above), end to end, before generalising.
2. Migration: `provider_webhook_events(event_id PK, event_type, received_at, signature_valid, payload jsonb (PII-minimised:
   ids, status, amounts, method kind only), processed_at, attempts, last_error)`; no tenant access; service role
   INSERT/UPDATE only. `billing_internal.record_webhook_event(...)` (insert on conflict do nothing, returns `new|duplicate`).
   `billing_internal.apply_provider_state(p_tenant, p_snapshot, p_event_id, p_now)`: validates the snapshot shape, cross-checks
   `provider_subscription_id`, maps provider status (`created`, `authenticated`, `active`, `pending`, `halted`,
   `cancelled`, `completed`, `expired`) plus the charge facts to T1-T8 (SUB §6.3), maintains `access_ends_at` per the §6.2
   table, writes `subscription_events`, bumps `version`, bumps the `billing`/`settings` domain versions; a snapshot older
   than the stored one (by provider `updated`/charge time) is a no-op.
3. `BillingProvider` interface (SUB §3.3 methods + `fetchPayment`, `fetchRefunds`), `RazorpayProvider` (fetch adapter,
   D-1), `FakeBillingProvider` (D-2: subscriptions, authorisation, charge success/failure, retries to `halted`, cancel,
   offers, refunds; driven by the control route and by `TEST_NOW`).
4. Webhook route (Node runtime): raw body, HMAC-SHA256 `timingSafeEqual` on equal-length buffers, 400 without body logging
   on mismatch, size cap 256 kB, event id from `x-razorpay-event-id` (required), insert, enqueue
   `billing.sync_subscription` (`dedupe_key = provider_subscription_id`) or `billing.sync_refund`, 200 in < 50 ms local.
   Unknown event types: recorded, 200, nothing enqueued.
5. Sync job: fetch subscription (+ latest invoice/payment), apply; records the payment for 13B-04 (writer added there).

Tests: pgTAP `billing_provider.test.sql` (grants; T1 from `authenticated` snapshot; duplicate event no-op; out-of-order
`charged` before `authenticated` converges; a snapshot for another tenant's `provider_subscription_id` refused; older
snapshot no-op; version bump; events written). Vitest: adapter contract with msw fixtures (auth header, timeouts, error
mapping); webhook route (bad signature 400, missing event id 400, replay → one job, unknown type ignored, oversize 413);
`nextState` case table (every T1-T12 path, late success, charge after cancel, revoke in trial, halted before grace end)
run against both TS and SQL. Fails-without (High: forged webhook): with the signature check bypassed the forged event
moves the clinic; recorded, restored.
Done: tracer green; a forged or replayed webhook changes nothing; duplicate events process once.

### 13B-02 Owner signup, onboarding and mandate checkout (AUTH-07, PWA resume) · L · migration 000181_owner_onboarding · split point after step 3

Goal: an owner goes from `/signup` to `trialing` with a verified email, a billing profile and an authorised mandate, and
an interrupted checkout (iOS standalone return) recovers by itself.

Files: `supabase/migrations/000181_owner_onboarding.sql`; `supabase/tests/database/owner_onboarding.test.sql`;
`app/(auth)/signup/{page.tsx,signup-form.tsx,verify-form.tsx}`; `features/auth/signup-flows.ts`; `app/(auth)/login/page.tsx`
(link); `supabase/config.toml` + `scripts/ci/check-auth-config.mjs` policy (`enable_signup = true`, CAPTCHA on);
`app/(onboarding)/clinic/new/*` (D-8 refusal copy); `app/(onboarding)/onboarding/billing/{page.tsx,billing-profile-form.tsx,start-trial.tsx,checkout-modal.tsx,confirming.tsx}`;
`features/subscriptions/{commands.ts,system.ts,queries.ts,schemas.ts}`; `app/api/billing/status/route.ts`;
`lib/auth/access-redirect.ts` (routing table AUTH §3.3 incl. the neutral page for removed/used-trial users);
`lib/jobs/internal/handlers/billing-housekeeping.ts` (`subscriptions.expire_unauthenticated`, `tenants.delete_incomplete`,
`auth.purge_unconfirmed`); `messages/en.ts`; `tests/e2e/onboarding/{signup,checkout,checkout-resume}.spec.ts`.

1. Migration: `billing_profiles(tenant_id PK, legal_name, gstin (format + checksum CHECK via `billing_internal.gstin_valid`),
   state_code (GST state list), address, billing_email, whatsapp_billing_opt_in, plans_branches, version)`, owner/admin
   SELECT under `authz.billing_tenant_ids()`, writes only via `public.save_billing_profile` (definer, owner/admin,
   `ROW_CHANGED`); `billing_owner_ledger` (D-9); `create_clinic_with_owner` refusal (D-8) and the `incomplete` cap;
   `billing_internal.begin_checkout(p_tenant, p_provider_subscription_id, p_start_at, p_now)` (stores the created provider
   subscription, refuses a second live `created` one, D-18); `platform_settings.public_signup_open boolean default false`
   (D-10); housekeeping functions with `p_now`.
2. Signup (AUTH §3.1): Turnstile, `signUp` with the same response shape whatever the email state, code entry,
   `verifyOtp`, `updateUser({password})` then `signOut({scope:'others'})` (fallback through `features/auth/system.ts` only
   if the pinned AUTH-00 test shows the setting blocks it), DPDP owner notice, Terms acceptance stored with version;
   resend with a 60 s cooldown; per-account verify limiter (5 per 15 min); hook failure shows the same code screen.
3. Clinic → `/onboarding/billing` step 1 (profile, branch question) → step 2 "Start free trial" with the clear copy
   ("₹5 is verified and refunded; nothing is charged before <date>; then ₹1,499 + GST (₹1,768.82) per month; cancel
   anytime"). Server action `startTrialCheckout`: owner, `requireRecentAuth` not needed (fresh session), computes
   `start_at = (IST date of now + 14 d) 10:00 IST` (or the coupon-shifted date, 13B-06), `createSubscription(...,
   total_count 120, customer_notify false, notes {tenant_id, subject 'base'})`, `begin_checkout`, returns the
   checkout options (key id, subscription id only). Repeat owner (ledger) → immediate start, no trial copy.
   D-10 gate: without a code and with signup closed → "Sign-ups open soon" (the clinic stays `incomplete`).
4. Modal `handler` → `verifyCheckout` server action: HMAC of `payment_id|subscription_id` with the key secret, then
   `fetchSubscription` → `apply_provider_state` (T1). On every load while `incomplete` with a stored provider id: fetch and
   apply; client polls `/api/billing/status` every 3 s for 2 min after a close without result; "Confirming your AutoPay…";
   "Start trial" never shown again while a `created` subscription exists; "Try again" after the 60-min expiry job.
5. Housekeeping schedules (cron → jobs): expire unauthenticated (hourly), delete `incomplete` clinics after 7 days (no
   clinical data possible), purge unconfirmed auth users after 7 days.

Tests: pgTAP (profile RLS and command; D-8; ledger; `begin_checkout` refusals; housekeeping with `p_now`; grants). Vitest:
signup flows (uniform response, pre-hijack update called, hook failure path), checkout signature (valid/invalid/other
subscription), start_at computation across IST midnight and month ends. E2E (desktop-chrome, pixel-7, iphone-15; Fake;
Mailpit): J-A1 signup → code → clinic → profile → checkout → `trialing` → role home; an unverified email cannot reach
clinic creation; checkout closed then reopened → "Confirming…" then `trialing` from the server fetch (modal result
dropped); a repeat owner gets no trial; axe on every step. Fails-without (High: mandate for an unverified email): with the
verified-email check removed from clinic creation, an unverified user creates a clinic; recorded, restored.
Done: J-A1 green on the matrix; `enable_signup` on in config-as-code; IND I-1 closed.

### 13B-03 Lifecycle tick, reconcile, notices · M · migration 000182_billing_lifecycle

Goal: time-based transitions, locking side effects, reconciliation and owner notices happen without anyone watching, and
the access rule never depends on them having run.

Files: `supabase/migrations/000182_billing_lifecycle.sql`; `supabase/tests/database/billing_lifecycle.test.sql`;
`lib/jobs/internal/handlers/billing-{tick,reconcile,notify}.ts`; `lib/email/templates/billing/*.tsx`;
`features/subscriptions/notices.ts`; `tests/billing/{notices-no-links,reconcile}.spec.ts`; `tests/e2e/billing/lifecycle-fake.spec.ts`.

1. `billing_internal.lifecycle_tick(p_now)`: T3 time rule (no charge by anchor + buffer), T5, T6, T7 (T9 archive is
   13C-04), comp-on-trialing status at trial end (D-17), `trial_start NOT NULL` when `trialing` CHECK (A13); returns the
   transitions; each guarded by `version`/`from_status`; in the same transaction at `expired`: revoke the tenant's
   `document_share_tokens` (except SUB-D6 verification metadata), suspend API keys, pause outbound webhook subscriptions,
   cancel queued patient messages (status `cancelled`); re-enable on T8.
2. `billing_notices(tenant_id, notice, due_on, sent_at, channel)` unique per (tenant, notice, due_on) = dedupe;
   `billing.notify_upcoming` daily 09:00 IST: T-3/T-1 debit (with date and ₹ amount; coupon-aware after 13B-06), grace
   −2/−1, period-end −3, archive −7/−1 and purge −30/−7/−1 (archive/purge texts used by 13C), each linking only to
   `/settings/billing` or `/billing/locked`. Owner billing notices are claim-exempt from the locked-tenant job skip (they
   must reach a locked owner).
3. `billing.reconcile` daily 03:00 IST: every non-terminal subscription fetched and applied; any correction raises the
   `billing_divergence` alert (V2-04 alert route); unreported credit notes 30 days before 30 Nov (wired in 13B-07).
4. Schedules: tick every 15 min, reconcile 03:00 IST, notify 09:00 IST (pg_cron → jobs, idempotent claim).
5. GSTIN guard (D-10 corollary): reconcile and notify raise `debit_without_gstin` (critical) when any subscription has a
   debit due within 5 days and `supplier_gstin` is NULL; the alert text names the slip runbook (15-04).

Tests: pgTAP with `p_now` (the SUB §11 access-level table end to end through the tick: trial cancelled locks at
`trial_end` exactly; active cancelling at `current_period_end`; past_due at `least(grace_until, halted_at)`; buffer and
grace 0; comp; share tokens revoked; API keys suspended; idempotent second tick; GSTIN alert). Vitest: every template
rendered with fixtures contains no storage host, `token=`, signed URL or code (fails-without: a template with a signed
URL fails it); reconcile divergence → alert row. E2E (Fake, `TEST_NOW`, desktop-chrome): signup → day 15 charge →
renewal → cancel at period end → lock at period end (owner to `/billing/locked`, staff to `/billing/locked/staff`).
Fails-without (High: access after cancel): with the tick disabled, the cancelled clinic still locks at period end (proves
the rule is timestamp-based).
Done: lifecycle acceptance row of the roadmap passes as time-travel DB tests plus the Fake e2e.

### 13B-04 SaaS GST invoices and payments · M · migration 000183_saas_invoices

Goal: every captured charge has exactly one gapless, correct GST invoice whose total equals the debit.

Files: `supabase/migrations/000183_saas_invoices.sql`; `supabase/tests/database/saas_invoices.test.sql`;
`lib/billing/{tax.ts,invoice-number.ts}`; `features/subscriptions/invoice-pdf/{document.tsx,render.ts}`;
`app/api/billing/invoices/[id]/pdf/route.ts`; `tests/billing/{tax-split,invoice-pdf-golden,invoice-numbering}.spec.ts`.

1. Migration (D-14): `saas_payments` (provider payment id UNIQUE, amount, status, method, captured_at, refunded_paise);
   `saas_invoices` (final shape; buyer snapshot from `billing_profiles` + supplier snapshot from `platform_settings` at
   issue; `sac`; `place_of_supply`; `pdf_sha256`); `saas_invoice_sequences(fy, series)` with `INV`/`CN`;
   `billing_internal.issue_invoice(p_payment, p_now)` (row lock on the sequence, same transaction as the insert; FY from
   the shared V2-10 `lib/fy` rule mirrored in SQL; `CQ/2026-27/000123` format; total must equal captured amount, else
   taxable back-calculated and `billing_invoice_mismatch` alert, SUB §14.5 step 5); `billing_internal.tax_split()` twin.
   Owner/admin SELECT via `authz.billing_tenant_ids()`; no writes for any API role. FKs to `tenants` are RESTRICT
   (survivors, SUB §6.6; the tenant row is tombstoned, never deleted, 13C-04).
2. The sync job writes the payment and issues the invoice on `charged`; the invoice email (no attachment link; "download in
   the app") goes through the notice path.
3. PDF (D-13): rendered on demand for owner/admin of that clinic (also while locked/archived), `private, no-store`,
   labels "Tax invoice", supplier GSTIN, buyer GSTIN when present, SAC, CGST+SGST or IGST, total in words.

Tests: pgTAP (gapless numbering under 50 parallel issues; FY rollover at 1 Apr 00:00 IST; intra/inter split; total =
captured; grants; another clinic cannot read). Vitest: tax case table (TS and SQL), PDF golden file (hash), 50-parallel
numbering through the RPC. Fails-without (High: numbering gap/duplicate): with the sequence lock removed, the parallel test
shows a duplicate; recorded, restored.
Done: ₹1,499.00 + ₹134.91 + ₹134.91 (or ₹269.82) = ₹1,768.82 on the golden invoice; numbering gapless.

### 13B-05 Owner billing UI, locked pages, banners, lock end to end · M · no migration

Goal: the owner manages billing alone (DR7), every price reads "₹1,499 + GST", AI shows "Coming soon", and a locked clinic's
open tablet stops showing data within one poll interval.

Files: `app/(dashboard)/settings/billing/{page.tsx,*.tsx}` (rebuild; drop the "Plan management arrives with billing"
copy); `app/billing/locked/{page.tsx,staff/page.tsx}` (styled, renew/re-purchase, invoices, staff list read-only, export
slot filled by 13C-03); `components/subscription/{banners.tsx,cancel-dialog.tsx,change-method.tsx}`;
`features/subscriptions/commands.ts` (`cancelSubscription`, `resumeSubscription`, `changePaymentMethod`, `repurchase`);
`lib/auth/sensitive-actions.ts` (billing entries: aal2 via `requireRecentAuth` when TOTP is enrolled, AUTH §4.6);
`lib/auth/access-page.ts` (membership-ended → sign-in page, not the error page); `tests/e2e/billing/{owner-billing,lock-open-tablet}.spec.ts`.

1. Billing page: status line ("Free trial until 24 Nov, then ₹1,499 + GST (₹1,768.82) per month via UPI AutoPay
   (…@okhdfc). Cancel anytime."), next debit, masked method, invoices with PDF links, cancel (trial: "continues until …;
   you will not be charged"; paid: "access until …"), resume (trial: new subscription with the same `start_at`; paid before
   period end: new subscription from period end), change method (new subscription from the next anchor, old cancelled at
   cycle end; SUB §8.2), "AI features: Coming soon" row, no AI price or buy button anywhere.
2. Locked pages: owner/admin renew (T8: new subscription, immediate start, first charge), invoices, export slot; staff page
   unchanged copy; both reachable for a locked clinic only.
3. Banners: trial (days left), past due (update method), cancelling, AI preview ends with the trial.
4. Spec 9: two contexts, Today open on a tablet profile; `TEST_NOW` passes `access_ends_at`; the next action is refused
   (`SUBSCRIPTION_LOCKED`) and the heartbeat/poll sends the device to `/billing/locked` with Realtime unsubscribed and the
   query cache cleared, within the poll interval (page clock).

Tests: e2e (matrix; Fake): cancel in trial, resume, change method, re-purchase from locked; every price label grep at
runtime on rendered pages (DOM text, not source); no AI purchase control (DOM + server: no action or route can create an
AI subscription, server test); spec 9 as above; axe 360/820/1280. Vitest: commands refuse non-owners and stale versions.
Fails-without (High: open tablet keeps data): with the D-8 trigger on `SUBSCRIPTION_LOCKED` removed, the tablet keeps
showing Today; recorded, restored.
Done: PR 13b-i acceptance (below) met; reviews; 13B-08a; evidence; push.

### 13B-08a Review fix round for 13b-i · S-M · migration 000184_review_fixes_13b_i (only if SQL is needed)

Highs and Mediums fixed with a test that fails without the fix (Opus for security fixes); Lows cheap and local or to the
backlog with an owner (V2-14 sweeps them); Highs re-checked once.

### 13B-06 Coupons: data layer, redemption, deferred start_at, owner code entry (SUB-COUPON-01/02/03/07) · L · migration 000185_coupons · split point after step 3

Goal: one server-validated code per subscription defers or discounts debits exactly as SUB §14 says, with no stacking and
caps that hold under concurrency.

Files: `supabase/migrations/000185_coupons.sql`; `supabase/tests/database/coupons.test.sql`; `lib/billing/coupon-pricing.ts`;
`features/subscriptions/coupons.ts` (`validateCoupon`, reservation inside `startTrialCheckout`, re-purchase);
`app/(onboarding)/onboarding/billing/code-field.tsx`; `components/subscription/{offer-line,reconfirm-banner}.tsx`;
`docs/runbooks/subscriptions-sql.md` (coupon snippets); `tests/billing/coupon-pricing.spec.ts`;
`tests/e2e/billing/{coupon-free-cycles,coupon-uat,coupon-limits}.spec.ts`.

1. Migration: `coupons` (kind CHECKs per SUB §14.3), `coupon_applicability` (empty = fail closed), `coupon_codes` (citext,
   stored normalised, UNIQUE; Crockford base32, 12 chars), `coupon_provider_offers` (UNIQUE coupon/price/supply type),
   `coupon_redemptions` (partial unique `(tenant_id) where status in ('reserved','applied')`; caps counted with
   reservations under row locks); `tenant_subscriptions.funded_by`; RPCs `platform.create_coupon` (computes both supply-type
   totals and offer amounts; refuses percent/amount while `offer_coupons_enabled = false`), `generate_codes` (returns codes
   once), `register_provider_offer` (refuses a mismatched amount), `set_coupon_status` (refuses enabling a percent/amount
   coupon without both offers), `apply_coupon_to_tenant` (before checkout: `reserved`, channel admin; after: creates the
   owner "Re-confirm AutoPay" task), `revoke_redemption`; `billing_internal.reserve_redemption`, `apply_redemption` (inside
   T1), `release_stale_reservations` (with the 60-min expiry job), `record_coupon_cycle` (each charge). Owner view
   `my_coupon_redemption` without code or code id. No tenant access to coupon tables.
2. Validation (server only): owner of the onboarding tenant; Postgres limiter 5 per 15 min per user and per IP, 20 per day
   per tenant; uniform "This code can't be used" except "You have already used this offer" to that owner; returns the
   description and first debit date/amount; `?code=` read once and stripped (`history.replaceState`),
   `Referrer-Policy: no-referrer` on `/onboarding`, query strings excluded from request logging there.
3. Checkout: `start_at` shifted (free cycles: + N IST months at 10:00; trial extension: + X days and the trial continues;
   `uat`: `max(trial_end, free_until)`); percent/amount: `offer_id` by supply type; UAT grants written as overrides with
   `expires_at = free_until`; at original `trial_end` the tick moves `trialing → active` with `funded_by = coupon`.
   Carry rules on resume, re-purchase and change method (SUB §14.6); cancel forfeits remaining cycles with the screen
   stating it. The D-10 gate accepts a valid `uat` code.
4. Charges: expected amount compared with captured; mismatch → alert + invoice from captured (13B-04 path).
5. Owner UI: code field (step 2 and re-purchase), preview text, billing page "Free until …" / "Discount n of N", re-confirm
   banner, cancel-screen forfeiture notice.

Tests: pgTAP (kind CHECKs; `uat-ab12` = `UATAB12`; no stacking; global/per-code/per-owner/per-tenant caps incl. reservations
with two sessions; `first_subscription_only`; IST window boundaries; per-supply offers 141506 both / 88442 intra / 88441
inter; enable refused without both offers; late UAT admission `start_at = trial_end`; lifecycle with free cycles, trial
extension, cancel in free period → locked at `start_at` with no buffer, cancel in trial → locked at `trial_end`, UAT
override expires at `free_until`; tenants cannot select coupon tables; `authenticated` cannot call coupon RPCs). Vitest:
`couponPricing` table; uniform errors; limiter. E2E (Fake, `TEST_NOW`): free-cycles signup → trial → free period → first
discounted (or full) charge with invoice lines checked; `uat` code signup with AI preview until `free_until`; 6th wrong
code refused by the limiter with the same message; admin applies after mandate → re-confirm task → new subscription.
Fails-without (High: redemption race): with the reservation lock removed, two parallel redemptions of a single-use code
both apply; recorded, restored.
Done: §14.10 criteria 1, 2, 4, 6 and 8 met; percent/amount proven on the Fake behind the switch.

### 13B-07 Discount line, credit notes and refunds (SUB-COUPON-04/05) · M · migration 000186_refunds_credit_notes

Goal: a refund is idempotent, audited, never changes access, and issues a credit note whose lines reverse the invoice
exactly; a Dashboard refund is imported.

Files: `supabase/migrations/000186_refunds_credit_notes.sql`; `supabase/tests/database/refunds_credit_notes.test.sql`;
`lib/billing/credit-note.ts`; `lib/jobs/internal/handlers/billing-refund.ts`; invoice PDF discount line and credit-note
variant; `tests/billing/{credit-note-split,refund-webhooks}.spec.ts`; `tests/e2e/billing/refund-credit-note.spec.ts`.

1. Migration: `saas_refunds` (UNIQUE provider refund id and idempotency key); `platform.refund_payment(...)` (actor rule;
   captured, `amount ≤ captured − refunded`, < 6 months else refused with the runbook message; inserts `requested`,
   enqueues `billing.refund` with the idempotency key); `billing_internal.settle_refund` (from `refund.*` webhook + fetch);
   `billing_internal.issue_credit_note` (from the invoice's own lines: full = exact reversal; partial = invoice ratio half-up;
   final = remainder; series `CN`); discount line on invoices (`taxable = gross − discount`, code never printed).
2. Charge-after-cancel switches from alert to automatic `cancel_race` refund (D-16). Reconcile imports refunds whose
   provider `amount_refunded` differs from our sum (alert) and flags credit notes unreported 30 days before 30 Nov.
3. Refund webhooks routed by the 13B-01 route to `billing.sync_refund`.

Tests: pgTAP (credit notes sum exactly to the invoice: full refund of 88442 → taxable 74950, CGST 6746, SGST 6746; two
partials + final remainder; idempotent retried refund refunds once; 6-month guard; access unchanged; `authenticated`
non-admin and aal1 admin refused; audit rows). Vitest: credit-note split table (CGST/SGST and IGST); webhook fixtures
`refund.processed`, `refund.failed`, Dashboard refund imported, replay. E2E (Fake): partial refund via SQL RPC → credit
note PDF row downloadable by the owner. Fails-without (High: refund replay): with the idempotency key removed, a retried
job refunds twice on the Fake; recorded, restored.
Done: §14.10 criteria 3, 5 and 7 met.

### 13B-08b Review fix round for 13b-ii · S-M · migration 000187_review_fixes_13b_ii (only if SQL is needed)

As 13B-08a.

### Close (per PR: reviews, fix round, evidence, docs)

1. Reviews, fresh context, given the PR diff and this plan's decisions only. Isolated (Sonnet): flows against SUB §5-§6,
   §14; UI at 360/820/1280; tests assert outcomes. Adversarial (Opus): webhook forgery/replay/oversize; provider-truth
   rule (any path applying client or webhook state directly); `billing_internal` grants; `notes` trust; checkout
   signature; signup enumeration, pre-account hijack, unlimited clinics, trial reuse; `TEST_NOW` and the Fake unreachable
   in production builds; invoice numbering; notices without links; coupon enumeration, races, stacking, admin apply;
   refund idempotency and caps; RLS of every new table.
2. Evidence: `npm run stack:recycle`; `node scripts/phase-evidence.mjs .planning/phases/13B-saas-subscriptions/evidence 1`;
   push; CI green with 0 retried tests; `--ci-run <id>`.
3. Docs (Haiku): `13B-SUMMARY.md`, `13B-VERIFICATION.md` (tool output only), the roadmap status line, VERIFICATION_LOG
   entry (CI link + SHA, decisions D-1..D-19, CTO-1 outcome), `docs/runbooks/subscriptions-sql.md` (coupon, refund,
   comp, slip snippets), PO-ACTIONS 13B-P1..P5.
4. Gate: PO approves, or by delegation with the CI run recorded.

## Acceptance (per PR)

- **13b-i:** the roadmap V2-13b acceptance minus coupons/refunds: full lifecycle as time-travel DB tests plus the Fake e2e;
  failed debit → `past_due` → lock at grace or `halted`; Turnstile on signup; signup code via the configured email
  provider (Mailpit locally); forged/replayed webhook rejected, duplicate processed once; seeded divergence raises the
  reconcile alert; spec 9; unverified email cannot create a clinic or mandate; repeat owner no second trial (admin
  override works); gapless invoice numbers under parallel creation; plan amount 176882 and the Fake debit equals it;
  invoice split correct; every price label "₹1,499 + GST"; AI "Coming soon", no AI purchase path.
- **13b-ii:** SUB §14.10 1-8 (7 as the switch, enabled only after the PO's test-mode checklist).
- Staging items (Razorpay test mode: mandate, first charge at `now + 15 min`, failure → `pending`/`halted`, cancel, real
  webhook delivery, `customer_notify=false`, the §14.9 checklist, the R12 installed-PWA check) are PO actions recorded
  with IDs only; they do not block the code gate (deadline), they block G6.

## Threat register (STRIDE, condensed)

| ID | Cat. | Component | Sev. | Mitigation (test) |
|---|---|---|---|---|
| T-13B-01 | S/T | Webhook route | high | HMAC raw body, timing-safe, event-id dedupe, provider fetch as truth (fails-without 13B-01) |
| T-13B-02 | T | Checkout result from the client | high | Server signature check + `fetchSubscription`; client never sends state |
| T-13B-03 | E | `billing_internal.*` from clients | high | REVOKE + grants pgTAP |
| T-13B-04 | S | Signup enumeration / pre-account hijack / trial reuse | high | Uniform responses, `updateUser` + `signOut(others)`, ledger, D-8 (fails-without 13B-02) |
| T-13B-05 | E | `TEST_NOW` / Fake / control route in production | high | Env schema refusal + production-build test that the route 404s and the clock ignores `TEST_NOW` |
| T-13B-06 | I | Notices leaking links or codes | medium | Template regex spec (fails-without) |
| T-13B-07 | T | Invoice numbering under concurrency | high | Sequence row lock (fails-without 13B-04) |
| T-13B-08 | T | Coupon brute force / races / stacking | high | Limiter, uniform errors, partial unique index, locked caps (fails-without 13B-06) |
| T-13B-09 | T | Refund replay / over-refund | high | Idempotency key, cap check under lock (fails-without 13B-07) |
| T-13B-10 | D | Access after cancel if jobs stop | high | Timestamp access rule (fails-without 13B-03) |
| T-13B-11 | I | PII in `provider_webhook_events` | medium | Minimised payload; nulled after 90 days (13C-04 sweep) |
| T-13B-12 | R | Debit without GSTIN | high | D-10 gate + `debit_without_gstin` alert + slip runbook (15-04) |

## PO actions (external; the code does not wait for them)

- **13B-P1** Razorpay test-mode keys and a test webhook secret in staging Vercel (Production scope), the Standard test plan
  for 176882 paise created in the Razorpay Dashboard and its plan id sent to Claude (Claude prints the
  `platform.create_plan_price` snippet).
- **13B-P2** Run the Razorpay test-mode checklist on staging (SUB §11 rows + §14.9), recording IDs only; Claude prepares the
  checklist file `13B-RAZORPAY-TEST-MODE.md`.
- **13B-P3** R12 installed-PWA mandate check on an Android phone and an iPhone (UPI Intent, card, QR; interrupted and
  recovered).
- **13B-P4** MSG91 `account_billing` template approval (only to switch WhatsApp billing notices on; D-12).
- **13B-P5** Answer CTO-1 (default applies); staging migrate of 000180-000187 (not delegated).

## Out of scope

Recurring Payments mode for multi-branch clinics (CTO-1 default), annual plans, proration, the AI add-on (SUB-11, C41),
metered products, admin screens (13C), tenant export/archive/purge (13C), dual-secret webhook rotation, webhook replay UI.

## Execution (lean process)

- Executors: Opus `gsd-executor` for 13B-01, 13B-02, 13B-06, 13B-07 and security fixes; Sonnet for 13B-03..05; Haiku for
  docs/evidence. Never set a mode when starting a subagent (CLAUDE.md). Affected tests only per plan; one full PR lane at
  the end of 13B-05 and 13B-07; CI runs everything.
- Fails-without proofs (one per High control): 13B-01 forged webhook; 13B-02 unverified email; 13B-03 access after cancel
  without the tick; 13B-04 numbering; 13B-05 open tablet; 13B-06 redemption race; 13B-07 refund replay; plus the template
  regex.
- Target calendar: 13b-i 1-2 Dec, 13b-ii 2 Dec (needs V2-10..13 merged by 1 Dec morning); if late, 13b-ii is merged
  after 13C-01..02 rather than delaying 13C.
- Branch rules: off `feature/v2`, PR into `feature/v2`, never `main`, no force-push, local stack only.
