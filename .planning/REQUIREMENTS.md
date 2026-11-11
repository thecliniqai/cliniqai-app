# Requirements: clinicOS — milestone v2.0

**Defined:** 2026-11-11 (generated from `docs/v2/V2_MASTER_ROADMAP.md` §10)
**Core Value:** see `.planning/PROJECT.md`

> **Authority.** This is an index, not a specification. Each requirement is the approved backlog item in roadmap
> §10 (full descriptions, evidence and dependencies there; §10.2 items also in SUBSCRIPTIONS_AND_PLANS, AI_STRATEGY,
> AUTH_REDESIGN and PWA_STRATEGY). IDs and text are transcribed verbatim. If this file and the roadmap disagree,
> the roadmap wins. Regenerate rather than hand-edit.

**Phase mapping rule.** *Roadmap phase* is the roadmap's own placement, verbatim. *Closes in* is the last v2.0
phase named there (critical-path order: 00, DX, 01a, 01, 02 … 09a–c, 10 … 13, 13b, 13c, 14, 15, 16); the
requirement is checked off only when that phase passes its gate. Earlier phases deliver the parts the roadmap
assigns them.

## v2.0 Requirements

### P0 — technical debt, critical (§10.1)

- [ ] **P0-01**: Remove all `*Override` params from `"use server"` exports; move logic to `server-only` services; delete `notifyPrescriptionIssued`; AST/grep lint rule
- [ ] **P0-02**: `memberships` column REVOKE + `change_member_role` RPC with last-owner guard; owner/admin invites owner-only; (ride-along) SECURITY DEFINER tenant checks + `REVOKE … FROM anon`
- [ ] **P0-03**: Webhook lockdown: remove/env-gate the `dev`, Twilio and unknown providers (default deny); MSG91 header secret with `timingSafeEqual`; route only via `replyMsgId`; `.eq` not `.or`; no IDs or tokens in responses
- [ ] **P0-04**: Share tokens: tenant + `resource_type` binding on `/api/r`, `/r`, `/api/reschedule`, `/reschedule`, `/api/reports/view`, `/reports/view`; tokens created via an RPC verifying ownership; SELECT-only policy; fix the reschedule token (`resource_type`, `created_by`)
- [ ] **P0-05**: Lab-orders `storage_path` must start with the caller's tenant prefix; zod body validation
- [ ] **P0-06**: Patch `next` to the latest 15.5.x (fixes the Server Actions DoS and bundled postcss)
- [ ] **P0-07**: Confirm the hosted project (PO-1); stop tests against it. ~~Rotate unconditionally in V2-00~~ **Deferred by PO ruling (G0, 2026-11-10, C49):** no rotation in V2-00; the test project's keys die with it. **Mandatory before go-live (V2-15, §17.1):** revoke the account-wide `SUPABASE_ACCESS_TOKEN` and rotate every secret that is not scoped to the test project (MSG91 auth key + webhook secret, AI key, and any other non-test-project secret present — R2, CRON, Gemini, Gupshup, Twilio — if set), with the smoke check recorded in `docs/ops/secret-rotation.md`. If PO-1 = live, rotate again after the S0 deploy.
- [x] **P0-09**: Agent safety: Claude Code `permissions.deny` for `.env*`; replace `.planning/config.json` (`allow_default_branch_commits: false`, protected `main`, phase branches, independent reviewer)
- [ ] **P0-10**: Local ephemeral Supabase test lane: `.env.test`, global guard refusing non-local URLs, stop loading `.env` in Vitest, migrations + synthetic seed, run the existing 27 DB-backed suites on the local stack
- [ ] **P0-11**: GitHub Actions PR pipeline (typecheck, lint with tooling dirs ignored, unit, DB lane, build, audit gate, gitleaks) + branch protection + CODEOWNERS
- [ ] **P0-12**: Atomic job claim + lease + reaper; scheduler per C22; remove inline `dispatchPendingQueue` and fire-and-forget webhook dispatch; webhook idempotency
- [ ] **P0-13**: Auth/permission guard test over every server action and route handler + regression tests for P0-01 to P0-05
- [ ] **P0-14**: Role matrix alignment: **receptionist registration (PO-3 ✅)** in the matrix, RLS, UI and journey 8, with server-side dedup (AI-14)
- [x] **P0-16a**: **Before any migration on the hosted project:** confirm region, tier and PITR, or take a logical dump and test-restore it locally
- [ ] **P0-16b**: Consolidate the backup runbooks; **restore drill passed before UAT start** (on free tiers: restore of an FT-02 production dump into a local stack) and **again before paid launch** (PITR restore after the Pro upgrade)

### P1 — technical debt (§10.1)

- [ ] **P1-01**: Role-aware RLS (ADR-006) for all clinical, financial and comms tables + generated pgTAP matrix covering 100% of tenant tables
- [ ] **P1-02**: Composite `(tenant_id, id)` FKs (NOT VALID → diagnose → VALIDATE); `prescription_items.tenant_id`
- [ ] **P1-03**: Clinical immutability: triggers on signed rows + amendment RPC; write-once PDFs (`upsert:false`, versioned path, SHA-256); no member DELETE on lab docs; interim API PATCH guard
- [ ] **P1-04**: Audit v2: actor forced from `auth.uid()`, written inside the tx; revoke direct INSERT; read-access events
- [ ] **P1-05**: Atomic server commands as plpgsql RPCs (C18) for invoice+items, payment, sign-off (+audit+outbox), amendment, check-in, walk-in, register+book, collect
- [ ] **P1-06**: Billing invariants (**PO-4 ✅ accepted**): status guards, overpayment cap, cancel/void/refund, Indian-FY counter table (`INV/2026-27/00001`, shared `lib/fy` with SUB-05), money CHECKs, one active invoice per visit; no patient payment gateway
- [ ] **P1-07**: Visit state machine (DB + service); check-in validation; role-gated consult entry; `/consultation/[id]` permission gate
- [ ] **P1-08**: CASCADE → RESTRICT on clinical and financial children; drop `visits_delete_member`
- [ ] **P1-10**: Referrals: receiver may update status columns only; target constrained (directory/opt-in); consent check
- [ ] **P1-11**: Exports require `exports:create`; minimal DTOs
- [ ] **P1-12**: Multi-clinic: clinic switcher setting the active-tenant cookie; guard second-membership creation
- [ ] **P1-13**: Messaging governance at enqueue and send: opt-out, DPDP consent, quiet hours (tenant TZ), quota; no phone numbers in audit metadata or notifications
- [ ] **P1-14**: **Appointment** reminder producers only (PO-8 ✅): day-before + 2 h before by default, configurable per clinic, booked appointments only. Vaccine reminders → v2.1 (AI-25)
- [ ] **P1-15**: Fail-closed configuration: complete env schema; production forbids the dev messaging provider and mock AI; `/api/ready` checks providers through one SECURITY DEFINER health RPC returning counts only, no service-role client and no bucket check (ADR-0005 (erratum 2026-11-10, C50)) (the dev-OTP clause is dropped: AUTH-01 deletes the shortcut)
- [ ] **P1-17**: DPDP lifecycle: retention policy + purge/anonymise jobs (dry-run, PO approval after an isolated reviewer's check), restrict-vs-erase workflow + staff UI, storage deletion, erased rows hidden by RLS; machinery reused by SUB-07
- [ ] **P1-18**: Security headers + nonce CSP **including `worker-src 'self'` and `manifest-src 'self'`** (for PWA-02); `no-referrer` and `no-store` on PHI and token pages
- [ ] **P1-19**: zod 4 + AI SDK major upgrade (clears the remaining 9 audit findings) + `@supabase/ssr` upgrade from 0.5.2 + Dependabot
- [ ] **P1-20**: Self-reschedule fixes (IST slots, slot/conflict validation) + staff reschedule/cancel/no-show commands
- [ ] **P1-21**: `lib/datetime` (tenant TZ) and replacement of the 29 UTC "today" sites; lint ban
- [ ] **P1-23**: Sign-off error handling and `visit.completed` payload (`patient_id`; real `doctor_id`); drop the `queue_tokens.updated_at` write
- [ ] **P1-24**: Labs: **relabel as documents (PO-5 ✅)**; fix the in-consult upload dropzone; camera capture via PWA-12. Structured labs → P2-13 (v2.1)
- [ ] **P1-25**: Observability: error tracking (scrubbed; India-resident `ops.error_events` sink, no vendor outside India, §6), structured logger, request IDs (V2-03); dead-letter and queue-lag alerts (V2-04); log drain ≥ 180 days in India (V2-15, front-end drain if available; database logs after the Supabase Pro upgrade; FT-07 covers the UAT stage)
- [ ] **P1-26**: Distributed (Postgres) rate limiting for `/api/v1`, public token routes, AI and the Send Email hook; confirm Supabase Auth limits (the `requestOtpAction` throttle is obsolete: AUTH-04)
- [ ] **P1-27**: Test quality: Playwright scaffold + v1 characterisation e2e (6 flows) + axe; type-check tests; remove tautological and mock-isolation tests; teardown (P0 if the hosted project is prod)
- [ ] **P1-28**: Design system + frontend foundation: tokens, fonts, shadcn/Radix primitives, clinical components, shell, IA, command palette, route loading/error states, toasts
- [ ] **P1-29**: **Today** workspace (front desk / nurse / doctor) with Realtime + polling fallback, walk-in, check-in, vitals
- [ ] **P1-30**: PatientPicker + QuickRegister with server-side dedup everywhere; search GET endpoint
- [ ] **P1-31**: Booking, reschedule, cancel, no-show; schedule views; patient-context hand-offs
- [ ] **P1-32**: Consultation workspace + Rx rebuild (draft versioning, unload guard, keyboard Rx)
- [ ] **P1-33**: Collect payment + collections (en-IN money)
- [ ] **P1-34**: Platform hygiene: single service-role factory (all 5), generated DB types, migration immutability + drift baseline (B1), boundary lint rules (ESLint only: `no-restricted-imports` + `no-restricted-syntax`, bypass fixtures, the ADR-0005 exception register (erratum 2026-11-10, C50)), ESLint ignores for tooling dirs
- [ ] **P1-35a**: Staging environment: staging Supabase project (Mumbai, synthetic data) + Vercel staging; needed by V2-04 and V2-14
- [ ] **P1-35b**: Production environment per the C26 decision tree; approval-gated migration jobs (used by UAT and, unchanged, by the paid launch)
- [x] **P1-36**: GSD for Claude Code (pinned, project-local), archive v1 truthfully, `CLAUDE.md`, `docs/adr/`; **retire `.agents/` and `.opencode/`** and the OpenCode reviewer config (PO-11 ✅)
- [ ] **P1-37**: API v1 hardening: `withApi`, `api_authenticate()` principal (amended ADR-011), idempotency keys, DTO allow-lists, generated OpenAPI. **Drops to P2 if PO-16 finds no API consumers** (and `/api/v1` stays disabled).
- [ ] **P1-38**: Incident response + breach runbook (CERT-In 6 h, DPDP templates drafted by Claude, PO-12); `security.txt`
- [ ] **P1-39**: No double-booking: `btree_gist` exclusion constraint on doctor + time range (respecting `is_overbooked` and cancelled/no-show); overlap diagnostic first
- [ ] **P1-40**: Queue tokens: per-tenant-per-day counter table (`INSERT … ON CONFLICT DO UPDATE … RETURNING`), date computed in the tenant TZ in SQL; replaces `generate_daily_queue_token`
- [ ] **P1-41**: Quality gates for §15 and §17: coverage reporting in CI (report-only from V2-02, enforced at the G2 thresholds by V2-14); k6 at go-live load + Lighthouse mobile on Today and consult (V2-15). Split from P2-08.
- [ ] **P1-42**: Remaining e2e journeys 2, 3, 5, 7 and 10 at both viewports, each delivered with its workflow phase. TEST_STRATEGY T-14 raised from P2 (C32).
- [ ] **P1-43**: Remove the R2/S3 storage provider; Supabase Storage only (C23)

### P2 — technical debt (§10.1)

- [ ] **P2-01**: Next 16 upgrade (separate PR, before M2)
- [ ] **P2-02**: Bundle budgets in CI (the lazy AI drawer part is dropped: AI-01 removes the drawer; budgets merge with PWA-09)
- [ ] **P2-03**: Remove `VITEST`/`NODE_ENV` branches from production code; live AI eval lane
- [x] **P2-04**: Hygiene: test password, fix v1 verification records (E-12); **securely delete** (not move) `.planning/dev-messages.txt` and `dev-auth-logs.txt`, which contain phone numbers (AI §2.2 owner action), and record the deletion
- [ ] **P2-05**: Patient profile and history; paginated registers with URL filters; settings regroup
- [ ] **P2-06**: SSRF redirect/DNS hardening; filter-input validation; generic errors; share-link hygiene; upload hardening *(unverified: SEC-10, SEC-20 to SEC-23)*
- [ ] **P2-08**: Performance indexes (trigram search, FK indexes). The k6, Lighthouse and coverage parts moved to P1-41.
- [ ] **P2-09**: Webhook signing secrets: stop returning them on every list; show once at creation, then masked; rotate action
- [ ] **P2-10**: Print stylesheet and clinic letterhead for Rx and receipt
- [ ] **P2-11**: Tamper-evident audit: no UPDATE/DELETE even for `service_role` (trigger), optional `prev_hash` chain
- [x] **P2-DOC**: Errata: SECURITY §3 (C1), API §4 (C2), DATABASE §7 (C29), counts (C3-C8), SEC-01 "six actions" (C31), TEST_STRATEGY T-14 (C32), ARCHITECTURE_DECISIONS ADR-003/006/011 (C18, C19), SECURITY_VERIFICATION Semgrep rule (C20); fill SEC-08…33 template fields; TARGET §10 rows for frontend, testing and security tooling. **New-track errata (bodies, not only banners; sources PWA §12, AI §11.2, AUTH §10, SUB §13.2):** TEST_STRATEGY:247/249/269 (Pixel 5 lane → PWA §9.1 matrix; journey 1 OTP → password login); DATA_HANDLING processor rows (Vertex `asia-south1`, SES, Razorpay, Turnstile/HIBP, India error sink) and the §5 AI-metadata row; TARGET_ARCHITECTURE:151/305 (`lib/integrations/ai`, drop `ai.summary`, add `ai.reservations_cleanup`); DESIGN_SYSTEM:527/549 (no local drafts); UX_AUDIT:730 (server autosave); FRONTEND_TECHNOLOGY_ASSESSMENT:172 (`idb-keyval` rejected); FRONTEND_MIGRATION_PLAN:71/169/222; SECURITY_REMEDIATION P1-7 (`worker-src`/`manifest-src`, `/sw.js` headers) and P1-9 (→ AI-04/AI-05); THREAT_MODEL SR-8 (→ AI-04/AI-05)

### SUB-COUPON — coupons, discounts, SaaS refunds (§10.2)

- [ ] **SUB-COUPON-01**: Coupons data layer (round 3, SUB §14.3): schema, RPCs, RLS and pgTAP for `coupons`, `coupon_codes`, provider offers (**one per coupon, price and supply type `intra`/`inter`**; both required before a coupon is enabled; 50 % → 88442 / 88441 paise), redemptions, `saas_refunds`, invoice discount columns and a credit-note series
- [ ] **SUB-COUPON-02**: Checkout redemption: rate-limited validation (uniform errors); reserve → apply → release; deferred Razorpay `start_at` for free cycles, trial extension and `uat` codes (the mandate is still authorised with the ₹5 auto-refunded token); coupon-funded lifecycle transition; UAT feature grants; carry-over rules; re-confirm task when an admin applies a code
- [ ] **SUB-COUPON-03**: Razorpay **flat offers** for percentage and fixed discounts (computed by us on the GST-exclusive base, one offer per supply type picked at checkout from the billing-profile state; offers cannot leave a charge of ₹1 or less): test-mode spike first, then amount reconciliation and an enable switch
- [ ] **SUB-COUPON-04**: Invoice discount line, GST on the discounted taxable value, credit-note series and PDF
- [ ] **SUB-COUPON-05**: SaaS refunds: idempotent `platform.refund_payment` RPC, `refund.*` webhooks, reconciliation import of Dashboard refunds, credit note, audit (refunds are the UAT exception path)
- [ ] **SUB-COUPON-06**: Admin **Coupons** screen (campaigns, code batches, redemptions) and **Refund** action in `/platform`
- [ ] **SUB-COUPON-07**: Owner UI: code entry at checkout and re-purchase, discount and free-period display, forfeiture notice
- [ ] **SUB-COUPON-08**: UAT operations: `uat` campaign and assigned single-use codes, invite text, comp-access fallback runbook (if live mode or a long `start_at` is not available), **UAT exit checklist** wired into G7

### SUB — SaaS subscriptions, entitlements, platform admin (§10.2)

- [ ] **SUB-10**: Merchant readiness: public Terms (incl. retention and purge), Privacy, Refund & Cancellation, Pricing ("₹1,499 + GST"), Contact; start Razorpay KYC (**live mode needed at UAT start** for real mandates with `uat` codes, SUB-D9; comp fallback otherwise), get a Cashfree quote; **GST registration (GSTIN) before paid launch (G7)**: UAT on `uat` codes debits nothing, so it needs no GSTIN (PO-20, SUB §14.8)
- [ ] **SUB-01**: Product catalogue (`plans` with `kind`, `purchasable` and `visibility`), prices with a `billing_model` (flat, per unit, metered, included units + overage) and GST-exclusive fields (`base_amount_paise`, `tax_rate_bp`, `tax_inclusive = false`, derived charge amount; C44), entitlement keys, `tenant_subscriptions`, `platform_settings`, events (`tenant_addons` is deferred with SUB-11); `billing_internal` access and entitlement functions with caller-bound wrappers; transition RPCs; `platform.*` actor rule; seeds; drop v1 `subscriptions`/`payment_records`; `comp_until` for dev and staging tenants
- [ ] **SUB-02**: Enforcement of the hard stop: RLS and **storage policies** on the access helper, signed-URL TTL caps, `assertTenantAccess`, `requireEntitlement`, layout redirects, functional `/billing/locked` pages, `/api/v1` 402, jobs skip locked tenants
- [ ] **SUB-03**: Razorpay integration: `BillingProvider` (Razorpay + Fake), in-page checkout with PWA resume, signature verification, webhook route, cancel/resume/change method/re-purchase
- [ ] **SUB-04**: Lifecycle jobs: `lifecycle_tick`, daily reconcile + divergence alert, upcoming-debit and dunning notices (email; WhatsApp opt-in), incomplete clean-up
- [ ] **SUB-05**: SaaS GST tax invoices for the GST-exclusive price (₹1,499.00 taxable + CGST ₹134.91 + SGST ₹134.91, or IGST ₹269.82 = ₹1,768.82): FY numbering (shared `lib/fy`), PDF, email, credit-note rows
- [ ] **SUB-08**: Owner billing UI: `/settings/billing`, `/onboarding/billing`, trial/past-due/cancelling banners, locked pages styled; prices shown as "₹1,499 + GST" with the ₹1,768.82 debit stated at checkout; AI shown as "Coming soon" with no price or buy button (PO-21)
- [ ] **SUB-06**: Tenant data export (streamed ZIP, private India bucket, re-auth, 15-min in-app signed URL, audit; Vercel limits spike)
- [ ] **SUB-07**: Archive and purge (logical archive, purge with dry-run + admin approval, statutory survivors, deletion certificate)
- [ ] **SUB-09**: Platform admin portal `/platform`: tenant list/detail, trial extend, comp, overrides, reconcile now, lifecycle queue with purge approval; **minimal "Plans & prices" screen** (list plans and price versions; add a new price version through `platform.create_plan_price`; edit trial length, grace, buffer and quotas through `platform_settings`/`plan_entitlements` RPCs) so the PO configures pricing from the UI as asked (SQL stays the fallback); the screen also lists products with their billing model and the **availability switch** (`purchasable`, `visibility`), so AI products can be made purchasable later without a deploy once their purchase flow exists; platform-admin TOTP (with AUTH-08)

### AI — gating, Smart Assist, Scribe (§10.2)

- [ ] **AI-01**: Containment: remove both copilots, the drawer, the mic and `MockAiProvider`; scribe fails closed; relabel deterministic UI. Replaces P1-22
- [ ] **AI-02**: Labelling: "AI Assist" and "Smart Assist" tokens and glyphs; copy rules; CI grep for "AI" in base-plan copy; the **"Preview"** chip and note for AI during the trial and the **"Coming soon"** treatment on plan and billing pages (PO-21)
- [ ] **AI-03**: Entitlement checks, trial rule (1,500-draft trial quota, PO-21; post-trial per PO-25), owner opt-in, patient objection flag, kill switch, quota with expiring reservations, grants
- [ ] **AI-04**: AI gateway `lib/integrations/ai`, Vertex `asia-south1` adapter, pseudonymise, post-checks, `ai_calls`, rate limits. Supersedes P1-16
- [ ] **AI-05**: AI Scribe v2: server context, `{text, source_span}`, per-section accept, provenance, 6 failure states
- [ ] **AI-06**: Eval harness L1–L3, ≥ 60 synthetic golden cases
- [ ] **AI-07, AI-09, AI-10, AI-15**: Smart Assist: terminology search, shorthand expander, patient snapshot, follow-up → proposed appointment
- [ ] **AI-08, AI-11**: Smart Assist: Rx favourites fix; allergy check substance-level only (class-level deferred to v2.1 per PO-22). AI-11 replaces P2-12
- [ ] **AI-13, AI-14**: Smart Assist: slot suggestions; duplicate-patient detection (receptionist registration, PO-3)
- [ ] **AI-16**: Help search, vitals flags (if time permits)
- [ ] **AI-17**: Provider setup and terms: GCP project, caching and logging off, ZDR request, budget alert, Google DPA, AI terms, patient notice, licence checks
- [ ] **AI-18**: AI feature keys; catalogue rows for future AI products (`ai_assist` scribe add-on, `ai_voice_receptionist`) seeded with `purchasable = false`, `visibility = 'coming_soon'` and no provider plan; the `standard_trial` limit `ai.scribe.monthly_drafts = 1500`; the `platform.set_product_availability` RPC (the backend switch)

### AUTH — password login (§10.2)

- [ ] **AUTH-00**: Supabase Auth spike (verifyOtp types, CAPTCHA coverage, `/otp` behaviour, pre-account hijack fix, session deletion)
- [ ] **AUTH-01**: Delete v1 OTP login and join paths, dev OTP shortcut, dev auth logger; CI grep gates
- [ ] **AUTH-02**: Auth config as code, Mailpit, config-drift check
- [ ] **AUTH-03**: Amazon SES `ap-south-1`, DKIM/SPF/DMARC, sandbox exit, Send Email hook (SMTP fallback), bounce webhook
- [ ] **AUTH-04**: (a) minimal password sign-in + forgot password; (b) change password, error mapping, safe `next`, `POST /auth/signout` (server-side sign-out + `Clear-Site-Data: "cache"`; PWA-02 later wraps it in `hardSignOut()`), Turnstile (Managed mode) on sign-in and reset (Supabase's CAPTCHA switch enforces these endpoints anyway; accepted default, C43), the FT-05 leaked-password check
- [ ] **AUTH-05**: Membership status, removal, session and API-key revocation. Replaces P1-09
- [ ] **AUTH-06**: Invitations v2 (email-bound, 72 h, revoke/resend, link + set password, in-app-browser-safe `/join`). Replaces P0-15
- [ ] **AUTH-07**: Owner signup (email + password + OTP verify + pre-hijack guard), owner DPDP notice, onboarding state machine, post-login routing by tenant state
- [ ] **AUTH-08**: TOTP MFA and `requireRecentAuth`; owner email change and transfer; platform-admin aal2 with two factors and break-glass. Absorbs P2-07
- [ ] **AUTH-09**: Session policy (900 s JWT, 7-day inactivity, 14-day time-box; app-side on Supabase Free, FT-06), sign out everywhere, auth audit (kept ≥ 180 days, FT-07); idle local sign-out via `hardSignOut()` on clinical screens (P2)

### PWA — installable web app (§10.2)

- [ ] **PWA-01**: Manifest, icons, `viewport`/`themeColor`, `appleWebApp`, `lang="en-IN"`; public PWA assets bypass auth and entitlement checks
- [ ] **PWA-02**: Hand-written service worker (allowlist), `/offline`, `/sw.js` headers only, `hardSignOut()` wrapping AUTH-04b's `POST /auth/signout` + grep guard, `no-store` on authenticated responses. The CSP `worker-src 'self'`/`manifest-src 'self'` directives ship with P1-18 in V2-14
- [ ] **PWA-03**: Standalone shell (safe areas, `dvh`, in-app Back, keyboard-aware bars, refetch on resume); tablet two-pane Today and Consult
- [ ] **PWA-04**: Install UX: Android prompt, iOS sheet, in-app-browser detection
- [ ] **PWA-05**: Update, skew and lock handling: `/api/session-status`, update toast, `SUBSCRIPTION_LOCKED` handling, Realtime unsubscribe, Skew Protection
- [ ] **PWA-06**: (a) `client_request_id` idempotency on write RPCs; (b) client timeout, retry-once, SaveStatus per workflow
- [ ] **PWA-07**: Input modes, autocomplete and 16 px inputs in primitives + guard test
- [ ] **PWA-08**: Playwright device matrix (phones, 744/800 tablets) + PWA specs 1–11 (cache audit, lock while open)
- [ ] **PWA-09**: Lighthouse CI on 4 routes: report-only, then blocking at V2-15
- [ ] **PWA-10**: Real-device checklist R1–R15 (PO run; scored by a reviewer agent), early after V2-08 and final at V2-15
- [ ] **PWA-12**: Camera capture for lab documents, Web Share of PDFs, manifest shortcuts

### FT — free-tier UAT mode (§10.2)

- [ ] **FT-01**: Project layout on free tiers: staging and production Supabase Free projects in **separate organisations** (2-active-project cap; production upgradable alone); v1 test project paused or deleted before staging is created; Vercel environments set up by the PO (PO-24 closed)
- [ ] **FT-02**: Self-run backups: `supabase db dump` (schema, data, roles) plus Storage object sync, twice a day, from a scheduled task in AWS `ap-south-1` (never a GitHub-hosted runner, PO-23(h)); encrypted with age before upload; versioned S3 bucket in `ap-south-1` with 30-day retention; failure alert; an on-demand dump before every production migration and purge batch; monthly restore drill into a local stack, logged in VERIFICATION_LOG; RPO ≤ 12 h, RTO ≤ 4 h (validate)
- [ ] **FT-03**: Inactivity-pause mitigation: pg_cron heartbeat every 6 h; pause-warning emails to a monitored inbox
- [ ] **FT-04**: Quota monitor: weekly job recording database size, Storage bytes and MAU, alerting at 60 % (upgrade trigger) and 70 %; the PO's monthly egress check; client-side image compression for uploads
- [ ] **FT-05**: App-side leaked-password check against the Pwned Passwords range API (k-anonymity) in every set-password server action; if the API is unreachable it allows the password and logs a warning (**Assumption (validate)**: availability over strictness at signup)
- [ ] **FT-06**: App-side session policy (14-day time-box, 7-day inactivity) while Supabase Free lacks the settings; session timestamps read through a SECURITY DEFINER function (columns confirmed in AUTH-00)
- [ ] **FT-07**: In-app retention (≥ 180 days, in India, within a size budget) of auth, platform-admin, billing-webhook and error events, because platform logs last 1 hour to 1 day
- [ ] **FT-08**: Upgrade runbook and early-trigger watch (§9.1); **execution of the Supabase Pro + PITR upgrade at UAT exit** (default; PO-26) with a PITR restore drill

## Future Requirements

Placed after v2.0 by the roadmap. Tracked, not in the v2.0 phases.

- **P2-13** (v2.1): Structured lab orders and results (PO-5 ✅: v2.1)
- **P3-01** (after v2.0): Persisted offline Today (with PWA-13 after a DPDP review); i18n scaffolding
- **P3-02** (after v2.0): DSC/eSign on e-prescriptions ⚖; ABHA column encryption; ASVS L2 self-assessment → ISO 27001 readiness
- **P3-03** (after v2.0): Mutation testing, visual regression, Supabase Branching, status page
- **AI-12, AI-21…AI-26** (v2.1): v2.1: dose calculator (after a regulatory check), ops copilot, patient advice, voice scribe, vaccine engine, Bedrock India adapter; AI-23 clinical Q&A unscheduled
- **PWA-13** (v2.1): v2.1: PHI-free staff web push; persisted offline Today after DPDP review

## Out of Scope

| Item | Reason |
|---|---|
| P0-15 | Superseded — see AUTH-06 (roadmap §10) |
| P1-09 | Superseded — see AUTH-05 (roadmap §10) |
| P1-16 | Superseded — see AI-03/04/05 (roadmap §10) |
| P1-22 | Superseded — see AI-01 (roadmap §10) |
| P2-07 | Superseded — see AUTH-08/09 (roadmap §10) |
| P2-12 | Superseded — see AI-11 (roadmap §10) |
| SUB-11 | Superseded — post-v2.0 (roadmap §10) |
| P0-08 — ~~*(Conditional on PO-1 = live.)*~~ **Not required: PO-1 = not live (2026-11-10).** Log forensics + DPDP/CERT-In assessment with counsel ⚖ | S0 contingency only; not triggered (PO-1 = not live) |
| Native mobile apps | PWA only in v2.0 (PWA_STRATEGY) |
| Selling any AI product | PO-21: no AI sold in v2.0; Scribe is a trial-only Preview |

## Traceability

| Requirement | Roadmap phase (verbatim) | Closes in (GSD phase) | Status |
|---|---|---|---|
| P0-01 | S0 (interim), V2-01 | 01 | Pending |
| P0-02 | S0, V2-01 | 01 | Pending |
| P0-03 | S0, V2-01 | 01 | Pending |
| P0-04 | S0, V2-01 | 01 | Pending |
| P0-05 | S0, V2-01 | 01 | Pending |
| P0-06 | S0, V2-01 | 01 | Pending |
| P0-07 | V2-00 (deferred), V2-15, S0 | 15 | Pending |
| P0-09 | V2-00 | 00 | Complete (G0) |
| P0-10 | V2-01a | 01A | Pending |
| P0-11 | V2-02 | 02 | Pending |
| P0-12 | V2-04 | 04 | Pending |
| P0-13 | V2-02 | 02 | Pending |
| P0-14 | V2-05 (backend), V2-08 (UI) | 08 | Pending |
| P0-16a | V2-00 (test project); production starts empty with the FT-02 backup job live (PITR only after the Pro upgrade, §9.1) | 00 | Complete (G0) |
| P0-16b | V2-15 (G6 drill), V2-16 (G7 drill) | 16 | Pending |
| P1-01 | V2-05 | 05 | Pending |
| P1-02 | V2-05 | 05 | Pending |
| P1-03 | V2-09a | 09A | Pending |
| P1-04 | V2-05 (triggers), V2-07 (in-tx) | 07 | Pending |
| P1-05 | V2-07 | 07 | Pending |
| P1-06 | V2-10 | 10 | Pending |
| P1-07 | V2-08 | 08 | Pending |
| P1-08 | V2-05 | 05 | Pending |
| P1-10 | V2-05 | 05 | Pending |
| P1-11 | V2-05 | 05 | Pending |
| P1-12 | V2-08 | 08 | Pending |
| P1-13 | V2-12 | 12 | Pending |
| P1-14 | V2-12 | 12 | Pending |
| P1-15 | V2-03 | 03 | Pending |
| P1-17 | V2-13 | 13 | Pending |
| P1-18 | V2-14 | 14 | Pending |
| P1-19 | V2-12 | 12 | Pending |
| P1-20 | V2-08 | 08 | Pending |
| P1-21 | V2-03 | 03 | Pending |
| P1-23 | V2-01 | 01 | Pending |
| P1-24 | V2-09b (dropzone), V2-11 (relabel) | 11 | Pending |
| P1-25 | V2-03, V2-04, V2-15 | 15 | Pending |
| P1-26 | V2-12 | 12 | Pending |
| P1-27 | V2-02 | 02 | Pending |
| P1-28 | V2-06 | 06 | Pending |
| P1-29 | V2-08 | 08 | Pending |
| P1-30 | V2-08 | 08 | Pending |
| P1-31 | V2-08 | 08 | Pending |
| P1-32 | V2-09b, V2-09c | 09C | Pending |
| P1-33 | V2-10 | 10 | Pending |
| P1-34 | V2-03 | 03 | Pending |
| P1-35a | V2-03 | 03 | Pending |
| P1-35b | V2-15 | 15 | Pending |
| P1-36 | V2-00 | 00 | Complete (G0) |
| P1-37 | V2-12 | 12 | Pending |
| P1-38 | V2-15 | 15 | Pending |
| P1-39 | V2-05 | 05 | Pending |
| P1-40 | V2-05 | 05 | Pending |
| P1-41 | V2-02, V2-14, V2-15 | 15 | Pending |
| P1-42 | V2-08 to V2-11 | 11 | Pending |
| P1-43 | V2-03 | 03 | Pending |
| P2-01 | V2-03 | 03 | Pending |
| P2-02 | V2-06 | 06 | Pending |
| P2-03 | V2-03 | 03 | Pending |
| P2-04 | V2-00 | 00 | Complete (G0) |
| P2-05 | V2-11 | 11 | Pending |
| P2-06 | V2-14 | 14 | Pending |
| P2-08 | V2-05 (FK), V2-08 (trigram) | 08 | Pending |
| P2-09 | V2-12 | 12 | Pending |
| P2-10 | V2-09c, V2-10 | 10 | Pending |
| P2-11 | V2-13 | 13 | Pending |
| P2-DOC | V2-00 | 00 | Complete (G0) |
| SUB-10 | V2-00/V2-01 (PO-side, right after G1) | 01 | Pending |
| SUB-01 | V2-05 | 05 | Pending |
| SUB-02 | V2-05 | 05 | Pending |
| SUB-03 | V2-13b | 13B | Pending |
| SUB-04 | V2-13b | 13B | Pending |
| SUB-05 | V2-13b | 13B | Pending |
| SUB-08 | V2-13b | 13B | Pending |
| SUB-06 | V2-13c | 13C | Pending |
| SUB-07 | V2-13c | 13C | Pending |
| SUB-09 | V2-13c | 13C | Pending |
| SUB-COUPON-01 | V2-13b | 13B | Pending |
| SUB-COUPON-02 | V2-13b | 13B | Pending |
| SUB-COUPON-03 | V2-13b (may slip until after paid launch; not needed for UAT) | 13B | Pending |
| SUB-COUPON-04 | V2-13b | 13B | Pending |
| SUB-COUPON-05 | V2-13b | 13B | Pending |
| SUB-COUPON-06 | V2-13c | 13C | Pending |
| SUB-COUPON-07 | V2-13b | 13B | Pending |
| SUB-COUPON-08 | V2-15 (campaign, codes, runbook), V2-16 (exit checklist) | 16 | Pending |
| AI-01 | V2-01 | 01 | Pending |
| AI-02 | V2-06 | 06 | Pending |
| AI-03 | V2-05 (DB) + V2-12 (app) | 12 | Pending |
| AI-04 | V2-12 | 12 | Pending |
| AI-05 | **V2-12** (plan 12-06, C37) | 12 | Pending |
| AI-06 | V2-02 (L1: copy and route greps), V2-05 (L2 gating contract matrix, database part), V2-12 (L2 gateway part, L3) | 12 | Pending |
| AI-07, AI-09, AI-10, AI-15 | V2-09b | 09B | Pending |
| AI-08, AI-11 | V2-09c | 09C | Pending |
| AI-13, AI-14 | V2-08 | 08 | Pending |
| AI-16 | V2-06 / V2-09b | 09B | Pending |
| AI-17 | V2-12 | 12 | Pending |
| AI-18 | **V2-05** (plan 05-09; moved from V2-13b, C41) | 13B | Pending |
| AUTH-00 | V2-01a (local); re-check in V2-03 | 03 | Pending |
| AUTH-01 | V2-01 | 01 | Pending |
| AUTH-02 | V2-03 | 03 | Pending |
| AUTH-03 | V2-03 (staging), V2-15 (production) | 15 | Pending |
| AUTH-04 | (a) V2-01, (b) V2-03 | 03 | Pending |
| AUTH-05 | V2-05 (backend), V2-11 (UI) | 11 | Pending |
| AUTH-06 | V2-05 (backend), V2-11 (UI) | 11 | Pending |
| AUTH-07 | **V2-13b** (C36) | 13B | Pending |
| AUTH-08 | V2-11 (clinic side), **V2-13c** (platform side) | 13C | Pending |
| AUTH-09 | V2-11 | 11 | Pending |
| PWA-01 | V2-06 | 06 | Pending |
| PWA-02 | V2-06 | 06 | Pending |
| PWA-03 | V2-DX, V2-06, V2-08, V2-09b | 09B | Pending |
| PWA-04 | V2-06 | 06 | Pending |
| PWA-05 | V2-06; lock path end to end in **V2-13b** | 13B | Pending |
| PWA-06 | V2-07; V2-08, V2-09b, V2-10 | 10 | Pending |
| PWA-07 | V2-06 | 06 | Pending |
| PWA-08 | V2-02, V2-06, V2-13b | 13B | Pending |
| PWA-09 | V2-06 → V2-15 | 15 | Pending |
| PWA-10 | V2-08, V2-15 | 15 | Pending |
| PWA-12 | V2-09c, V2-10 | 10 | Pending |
| FT-01 | V2-03 (staging), V2-15 (production) | 15 | Pending |
| FT-02 | V2-04 (built and drilled on staging), V2-15 (production) | 15 | Pending |
| FT-03 | V2-04 | 04 | Pending |
| FT-04 | V2-04 (job), V2-09c (compression) | 09C | Pending |
| FT-05 | V2-03 (with AUTH-04b); reused by AUTH-06/07 | 03 | Pending |
| FT-06 | V2-11 (with AUTH-09) | 11 | Pending |
| FT-07 | V2-03 (sink), V2-11 (auth events) | 11 | Pending |
| FT-08 | V2-15 (runbook, trigger watch), V2-16 (upgrade) | 16 | Pending |

**Coverage:**
- v2.0 requirements: 126 total
- Mapped to phases: 126
- Unmapped: 0 ✓
- Future: 6 · Superseded: 7 · Not required: 1

---
*Requirements defined: 2026-11-11*
*Last updated: 2026-11-11 at milestone v2.0 start*
