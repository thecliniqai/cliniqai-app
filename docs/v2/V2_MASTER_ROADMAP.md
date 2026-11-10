# clinicOS v2.0: Master Roadmap

| | |
|---|---|
| Status | **Revision 5: integrates the PO round-3 decision of 2026-11-10 (VERIFICATION_LOG, PO decisions addendum 4).** Vercel hosting is handled by the PO personally (PO-24 closed; R24 closed). Free tiers apply **only to a real-world UAT stage after all of v2 is built** (new phase **V2-16**, gate **G6 = UAT start**, gate **G7 = paid launch**), where tester clinics use the product free through **coupon codes** (refunds only as the exception); charging full-price customers starts only after G7, with the Supabase Pro + PITR upgrade as a UAT exit criterion. **Coupons, discounts and SaaS refunds** are now in v2.0 (SUB-COUPON-01…08). CAPTCHA (Turnstile Managed on all Supabase auth endpoints), the AI-preview owner opt-in, C13 and R13/R22 are settled (§1.2). Revision 4 integrated the round-2 decisions (₹1,499 exclusive of GST, no purchasable AI in v2.0, "rest all is fine"); **G1 was APPROVED by the PO on 2026-11-10** (§16; addendum 3). V2-00 may start and runs to G0, where ADR-005 is ratified; containment (V2-01a, V2-01) starts after G0; everything else waits for G2, and design implementation for G2-D (§16). **No blocking decision is open.** Earlier revisions: independent review (VERIFICATION_LOG, Review disposition) and reconciliation with the four new design documents (PO decisions addendum 2). |
| Date | 2026-11-10 |
| Branch | `feature/v2`. `main` is the v1.0 baseline and is never modified without the explicit exception in §1.4. |
| Evidence base | [VERIFICATION_LOG.md](VERIFICATION_LOG.md) records 91 claims independently verified (40 confirmed, 51 partially confirmed, 0 refuted), 32 cross-document contradictions with their resolutions (rulings now run to C44 across the addenda), the disposition of the independent roadmap review, **PO decisions addendum 2** (PO answers of 2026-11-10, new scope, and contradictions C33–C38 between the new documents) and **PO decisions addendum 3** (round-2 answers, G1 approval, free-tier operating mode, rulings C41–C44) and **PO decisions addendum 4** (round 3: Vercel handled by the PO, free tiers scoped to UAT, coupons, rulings C45–C48) |
| Detailed sources | [PRODUCT_BASELINE](PRODUCT_BASELINE.md) · [UX_AUDIT](UX_AUDIT.md) · [INFORMATION_ARCHITECTURE](INFORMATION_ARCHITECTURE.md) · [DESIGN_SYSTEM](DESIGN_SYSTEM.md) · [FRONTEND_TECHNOLOGY_ASSESSMENT](FRONTEND_TECHNOLOGY_ASSESSMENT.md) · [FRONTEND_MIGRATION_PLAN](FRONTEND_MIGRATION_PLAN.md) · [ARCHITECTURE_ASSESSMENT](ARCHITECTURE_ASSESSMENT.md) · [DATABASE_ASSESSMENT](DATABASE_ASSESSMENT.md) · [API_ASSESSMENT](API_ASSESSMENT.md) · [TARGET_ARCHITECTURE](TARGET_ARCHITECTURE.md) · [ARCHITECTURE_DECISIONS](ARCHITECTURE_DECISIONS.md) · [BACKEND_MIGRATION_PLAN](BACKEND_MIGRATION_PLAN.md) · [SECURITY_ASSESSMENT](SECURITY_ASSESSMENT.md) · [THREAT_MODEL](THREAT_MODEL.md) · [DATA_HANDLING](DATA_HANDLING.md) · [SECURITY_REMEDIATION_PLAN](SECURITY_REMEDIATION_PLAN.md) · [SECURITY_VERIFICATION_PLAN](SECURITY_VERIFICATION_PLAN.md) · [TEST_STRATEGY](TEST_STRATEGY.md) · [INFRASTRUCTURE_ASSESSMENT](INFRASTRUCTURE_ASSESSMENT.md) · [GSD_WORKFLOW_ASSESSMENT](GSD_WORKFLOW_ASSESSMENT.md) · **New (2026-11-10):** [SUBSCRIPTIONS_AND_PLANS](SUBSCRIPTIONS_AND_PLANS.md) · [AI_STRATEGY](AI_STRATEGY.md) · [AUTH_REDESIGN](AUTH_REDESIGN.md) · [PWA_STRATEGY](PWA_STRATEGY.md) |

**Labels used:** **Fact** (verified in code; see VERIFICATION_LOG), **Problem**, **Risk**, **Assumption (validate)**, **Recommendation**, **Decision** (an architect ruling on a contradiction). Priorities: **P0** critical blocker or security risk, **P1** essential for v2.0, **P2** important, **P3** optional. Sizes are relative (**S/M/L/XL**). No day counts are given (§14). ⚖ marks a point where legal counsel would normally be engaged; the PO declined counsel (PO-12), so each ⚖ item is a Claude-drafted default that the PO accepts as a recorded risk (R22).

Where this roadmap and a detailed document disagree, **this roadmap wins**. The disagreement is listed in VERIFICATION_LOG §4, and the detailed document receives an erratum.

---

## 1. Executive summary

### 1.1 Bottom line

- **Fact.** v1 proves the product. It covers the clinic day from booking through queue, consult and Rx to billing, plus WhatsApp, AI scribe and a public API. Much of the business logic is careful: the consent ledger, versioned prescriptions, signed webhooks and audit allow-lists. v1 is **not live** (PO-1): the `.env` project is a test database, and production will be a new Supabase project.
- **Problem (P0).** v1 is **not safe to run with real patient data**. Five independently confirmed defects let outsiders or low-privilege staff cross the clinic boundary or take over a clinic:
  1. **Server-action backdoor.** Client-supplied `sessionOverride` skips authentication and switches to the service-role client. In 4 confirmed browser-reachable actions (`searchPatients`, `updateClinicSettings`, `updateStatutorySettings`, `toggleGlobalConsent`), anyone holding a clinic's UUID can search that clinic's patients and write its settings and consent records. Two more (`getPatient`, `getPatients`) are pending OI-6 (SEC-01, C31).
  2. **Self-promotion to owner.** Any staff member can make themselves owner with one PostgREST call (SEC-03).
  3. **Unauthenticated messaging webhook.** It can confirm or cancel any clinic's appointments (SEC-04).
  4. **Share links bound to no tenant.** They can serve another clinic's prescriptions and lab reports (SEC-05).
  5. **API storage-path injection.** `POST /api/v1/lab-orders` stores any `storage_path`, which the share route then signs with the service role, giving a cross-tenant signed URL (ARC-06).
- **Problem (P0/P1).** Engineering foundations are missing:
  - no CI;
  - no isolated test database (tests write to the shared hosted test project);
  - no transactions;
  - no job scheduler, with duplicate-send races;
  - RLS enforces tenant only, not role;
  - no observability;
  - unverified backups.
- **Problem (P1).** Front-desk and doctor UX is the product's weak point:
  - receptionists cannot register patients (PO-3: they must);
  - the queue is not live;
  - multi-step writes are orchestrated from the browser;
  - consult edits can be lost;
  - there is no working design system;
  - accessibility and mobile fall short.
- **Problem (P1, new on 2026-11-10).** v1 has no business layer and costly auth. The PO's requirements add four tracks:
  1. **SaaS subscriptions** ([SUBSCRIPTIONS_AND_PLANS](SUBSCRIPTIONS_AND_PLANS.md)). There are no plans, pricing or billing today. v2 adds the Standard plan at **₹1,499/month + 18% GST** (₹1,768.82 debited; PO-20) per clinic on Razorpay Subscriptions. A UPI or card AutoPay mandate is set up at signup, the 14-day trial has no restrictions, and the first debit runs on day 15. The clinic can cancel any time, with access to the end of the paid period, then a **hard stop enforced in the database**. Data is locked for 30 days, then archived, then purged at expiry + 180 days. A platform admin portal lives at `/platform`; plans and prices are configured by SQL first and from the portal's Plans & prices screen once V2-13c ships. **Round 3:** coupon and discount codes (percentage, fixed, free cycles, trial extension and `uat` codes; one per subscription, no stacking) and audited, idempotent SaaS refunds with GST credit notes are added (SUB §14, SUB-COUPON-01…08).
  2. **AI gating** ([AI_STRATEGY](AI_STRATEGY.md)). The base plan has no LLM. Deterministic **Smart Assist** features (TypeScript/SQL, never labelled "AI") are included. One LLM feature, the AI Scribe, is built on Vertex AI in Mumbai with pseudonymised input, but **no AI product is sold in v2.0** (PO-21): the scribe runs only as a labelled **Preview** during the 14-day trial (1,500 drafts, owner opt-in), and plan and billing pages show AI as "Coming soon". Paid AI products are switched on from the backend once the AI Voice Receptionist ships; the catalogue and quota machinery are built now. Both copilots and dictation are removed in v2.0.
  3. **Password authentication** ([AUTH_REDESIGN](AUTH_REDESIGN.md)). Daily login uses email + password. Email codes go out only for owner signup and forgot password. Email is sent through Amazon SES in Mumbai. TOTP is optional for owners and mandatory for platform admins.
  4. **Installable PWA** ([PWA_STRATEGY](PWA_STRATEGY.md)). v2 adds "Add to Home Screen" on phones and tablets, a small service worker and no patient data on the device. There are no native apps at launch.
- **Recommendation.**
  1. **Contain first:** fix the P0 security defects and replace OTP login with password login in the first v2 phases (V2-01a, V2-01).
  2. **Build foundations next:** CI, local test DB, jobs, database-enforced authorisation, **subscription access and entitlements in RLS**, the design system and the installable shell.
  3. **Then rebuild the workflows**, highest-traffic first. Each new screen **replaces** its v1 screen directly. There are no rollout flags or dual paths, because go-live happens only after all of v2 is finished (PO-15).
  4. **Then add billing, coupons and the admin portal** (V2-13b, V2-13c), verify everything (V2-14), and stand up a new production project once (V2-15).
  5. **Run a real-world UAT** with tester clinics on free tiers and `uat` coupon codes (V2-16, from gate G6), then **launch paid** (gate G7) after the Supabase Pro + PITR upgrade and the UAT exit checklist (round 3, C46).

  Keep the platform: a modular monolith on Next.js App Router, Supabase Postgres, Auth and Storage, and Tailwind v4, plus shadcn/Radix open-code components, all hosted on Vercel and Supabase in India (PO-6/7). Vercel hosting is handled by the PO personally (PO-24 closed, round 3). Supabase runs on the **Free plan only during the UAT stage** (PO-17 as scoped by round 3) with mandatory compensating controls (§9.1), because UAT clinics may enter real patient data; production is upgraded in place to Pro + PITR at UAT exit, before any clinic is charged full price. Do not rewrite. Strangle module by module.
- **Effort.** Overall **XL**, larger than the first estimate. The work is delivered as **23 GSD phases** (22 build phases plus the V2-16 UAT stage), run **one after another** by a team of the **PO + Claude** (PO-18). Every gate is reviewed by an isolated Claude reviewer agent and approved by the PO (PO-10). The PO's own tasks with long lead times (payment-gateway KYC, GST registration, SES, Vertex AI, MSG91 templates) start right after G1, which was approved on 2026-11-10 (§13).

### 1.2 Decisions from the product owner

**Status (2026-11-10, round 3):** **every item from PO-1 to PO-24 is answered or closed.** The round-2 answers (verbatim in VERIFICATION_LOG, addendum 3) settle PO-17 (free tiers), PO-20 (GST-exclusive price) and PO-21 (no purchasable AI in v2.0), and confirm CAPTCHA on signup. "Rest all is fine" accepts the recommended defaults of PO-13, PO-16, PO-19, PO-22 and PO-23 (a)–(i). **G1 is approved** with these amendments. The round-3 decision (verbatim in addendum 4: "I'll handle Vercel … its only for user acceptance testing in real world where we will give the refunds or coupon codes to users to test the product … Yes we need to add coupon/discount codes") closes **PO-24** (handled by the PO personally), scopes PO-17's free tiers to the UAT stage, and adds coupons. **Open product decisions: PO-25 only** (AI after the trial; default applies); **PO-26 = confirm the Supabase upgrade timing** (default applies). SUB-D9 (real mandate) and SUB-D10 (AI preview until `free_until`) are **adopted defaults (PO may override)**; SUB-D11 (the UAT exit date) is a **PO operational input**, not a product decision (SUB §14.12). None blocks V2-00.

| # | Decision | PO answer (verbatim where given) and consequences |
|---|---|---|
| **PO-1** ✅ | Is v1 live with real patient data? Is the `.env` project production? | **No.** The `.env` project is a test database; go-live uses a new Supabase instance. S0, G-HF and P0-08 are not required; C26 resolves to a new production project; key rotation stays (P0-07). |
| **PO-2** ✅ | v1 hotfix on a branch from `main` | **Not applicable** (PO-1). `main` stays untouched. |
| **PO-3** ✅ | Role matrix: may receptionists register patients? | **"Yes they should be able to register."** P0-14 implements it in the matrix, RLS and UI (V2-05, V2-08), with journey 8 and SA-10 duplicate detection (AI-14) on the receptionist path. The rest of the earlier default is **adopted** (PO may override): receptionists register, book and collect, with no clinical notes; doctors view invoices for their own visits and use Sign & Bill, but do not collect, edit paid invoices or refund; admins have no clinical-note access by default. |
| **PO-4** ✅ | Billing scope: cancel, void, refund and FY invoice numbering | **"Accepted."** P1-06 builds cancel, void and refund, with invoice numbers per Indian financial year (e.g. `INV/2026-27/00001`) from a counter table. There is still no patient-side payment gateway. Clinic SaaS invoices (SUB-05) use their own FY series through a shared `lib/fy`. |
| **PO-5** ✅ | Labs: structured or document upload | **"Keep it as document upload; we will see the structured orders and results in v2.1."** P1-24 relabels Labs as documents (S), and the in-consult upload is fixed. Structured labs become **P2-13 (v2.1)**. |
| **PO-6 / PO-7** ✅ | Hosting and backups | **"Keep Vercel & Supabase."** India-only storage (PO-12). **Defaults to confirm** (sub-points): Vercel plan and account **handled by the PO personally** (PO-24 closed, round 3); functions in `bom1` (desirable); Skew Protection on if available. **Supabase Pro** in Mumbai `ap-south-1` (needed for leaked-password protection and session controls, AUTH). **PITR add-on, 7-day retention** (about US$100/month [S-PITR]). **RPO ≤ 2 min** (PITR worst case [S-PITR]); **RTO ≤ 4 h** during OPD hours (**Assumption (validate)** in the V2-15 drill). Nightly logical dump to an India-region bucket. **Superseded in part by PO-17 (round 2, scoped by round 3):** Supabase runs on the Free plan (no PITR, no automatic backups) **during the UAT stage only** (V2-16), with self-run encrypted dumps twice a day (RPO ≤ 12 h, FT-02) and an in-place upgrade to Pro + PITR at UAT exit, before full-price charging (PO-26), or earlier on any §9.1 trigger. |
| **PO-8** ✅ | Reminder scope | **"Appointments only at the moment; in v2.1 we will also send for vaccines, especially for Pediatrics."** P1-14 = appointment reminders only. Default timing: day before + 2 h before, configurable per clinic, and only for booked appointments. Vaccine schedules and reminders → v2.1 (AI-25). |
| **PO-9** ✅ | AI in v2.0 (SEC-16, SEC-15) | **Delegated to Claude ("Think from industrial stand point"); decided per [AI_STRATEGY](AI_STRATEGY.md).** One LLM feature, the AI Scribe (in v2.0 a trial **Preview** only, not sold; PO-21 round 2), on Vertex AI `asia-south1` only, with pseudonymised input, structured output with source spans, per-section accept, entitlement + owner opt-in + patient objection + quota + kill switch. Both copilots and dictation are removed in v2.0. Base-plan **Smart Assist** is deterministic. SEC-16 is closed by AI-04/AI-05. SEC-15 is the messaging dev logger, **not an AI finding**; it is closed by P0-03 and P1-15. AI pricing and the trial quota are PO-21. |
| **PO-10** ✅ | Reviewers | **"Claude can review everything, no human needed."** Every gate is reviewed by an **isolated Claude reviewer agent** (fresh context, read-only, no implementer transcript) and approved by the PO. Security gates add an adversarial reviewer. The residual risk R13 is **PO-accepted** on the strength of this answer (round 3). |
| **PO-11** ✅ | Tooling | **"Claude Code only, GSD install if needed."** Install GSD for Claude Code (project-local, pinned) in V2-00. Retire `.agents/` and `.opencode/` (and the OpenCode reviewer in `.planning/config.json`). Create the `v1.0-mvp-baseline` tag (adopted default). |
| **PO-12** ✅ | Counsel engagement | **"Not needed, we only store in India so that is fine."** No counsel is engaged. ⚖ items become PO-accepted defaults drafted by Claude (DATA_HANDLING §5, SUB §6.6, AI terms); residual risk R22 is **PO-accepted** on the strength of this answer (round 3). Note: obligations under the DPDP Act (notice, consent, breach reporting, retention) and the locations of sub-processors such as AI, email and messaging providers still apply regardless of where the main database is hosted. **Every component that still processes data outside India is listed for explicit PO acceptance in PO-23(h)**; error tracking uses an India-resident sink (P1-25), so no error-tracking vendor outside India is introduced. |
| **PO-13** ✅ | Go-live definition: number of clinics, users per clinic, device baseline | **Default accepted 2026-11-10 ("Rest all is fine"):** first 5 clinics × 3 users; low-end Android (2–3 GB RAM) + desktop Chrome + one iPad. Drives k6 load and the device matrix. |
| **PO-14** ✅ | Delete orphan `test-*@example.com` users on the hosted test project | **"Go ahead and delete."** **Done 2026-11-10** (executed by the coordinator; recorded in VERIFICATION_LOG addendum 2). R2 reduced. |
| **PO-15** ✅ | Deployment model | **"Not rolled out, first we finish entire v2 and then go-live."** Big-bang: production is built once in V2-15. No per-workflow rollout flags, dual write paths or soak periods (§11). Production environment, log drain and live payments are built in V2-15. **Round 3:** "go-live" is now two steps on the same production project: **UAT start** (G6; tester clinics on `uat` coupons, Supabase Free) and **paid launch** (G7; full-price charging after the Supabase Pro + PITR upgrade). |
| **PO-16** ✅ | Any real `/api/v1` key holders or webhook subscribers? | **Default accepted 2026-11-10:** none (v1 is not live). `/api/v1` stays disabled behind an env switch; P1-37 is P2 until a consumer exists. |
| **PO-17** ✅ | Budget | **"For Budget currently for 2-3 months we are going live with Free Tiers of both Supabase & Vercel."** **Round 3 (scope):** "its not 2-3 months, its only for user acceptance testing in real world where we will give the refunds or coupon codes to users to test the product." The earlier default (Supabase Pro + PITR, staging on Pro) is **replaced for the UAT stage only**. Consequences: production and staging run on **Supabase Free** in Mumbai **during the real-world UAT stage (V2-16)**, each in its **own organisation** so production can be upgraded alone. Supabase Free has no automatic backups, no PITR, no leaked-password check, no session time-box, 1-day API/DB logs and a cap of 2 active free projects, and UAT clinics may enter real patient data, so the compensating controls **FT-01…FT-08** (§9.1, §10.2) are mandatory, and production is **upgraded in place to Pro + PITR at UAT exit, before the first full-price charge** (a G7 exit criterion; timing confirmed by the PO in PO-26), or earlier on any §9.1 trigger. Vercel is handled by the PO (PO-24 closed). Still paid from usage: SES, Vertex (trial preview only), Razorpay fees, an S3 bucket and a scheduled task in AWS `ap-south-1` for backups (about US$1–2/month, **Assumption (validate)**), and one low-end Android test phone (PWA D4). **No external pen test** (default accepted): V2-14 relies on adversarial Claude review plus automated scanners; an external authorisation and tenant-isolation test is still recommended before scaling beyond the pilot. |
| **PO-18** ✅ | Team capacity | **"There are no engineers or any other staff, it's just you (Claude) and me."** Phases run one at a time. The bus-factor risk is R21. |
| **PO-19** ✅ | Product name, domain and home-screen icon (PWA D1, AUTH PO-A6) | **Default accepted 2026-11-10:** working name "ClinicQ", a teal tile with a "Q" glyph, and an `auth.` email subdomain of the final domain. Needed by V2-DX (icon) and V2-03 (email domain). |
| **PO-20** ✅ | Merchant facts for subscriptions (SUB-D1, SUB-10): GST registration status, GSTIN, legal name, state; is ₹1,499 GST-inclusive? | **"1499 excluding GST not including."** The Standard price is **₹1,499.00 + 18% GST**: CGST ₹134.91 + SGST ₹134.91 (clinic in the supplier's state) or IGST ₹269.82 (other states), so the clinic is debited **₹1,768.82 a month**. The Razorpay plan amount is therefore **176882 paise** (Razorpay charges the plan amount as given; confirm in test mode that nothing is added). Shown everywhere as **"₹1,499 + GST"**, with the ₹1,768.82 debit stated at checkout and in debit notices. `plan_prices` stores the base amount, the tax rate and `tax_inclusive = false`, and the charge amount is derived; all of it is configurable by SQL and later the Plans & prices screen (SUB §7.1, §8; C44). **GST can only be charged with a GSTIN**, so GST registration is a **paid-launch blocker** (G7, §17.2; round 3: UAT on `uat` codes debits nothing and needs no GSTIN). Still owed by the PO as a lead-time task, not a decision: GSTIN, legal name and state; Razorpay KYC starts right after G1. ClinicQ issues its own GST tax invoices (SUB-05) and does not rely on Razorpay's documents as tax invoices. |
| **PO-21** ✅ | AI pricing and the AI trial (AI D-1/D-2, SUB-D8; C33/C34, now superseded by C41) | **"…should be configurable going forwards as we intent to launch AI Voice Receptionist … lets not give an option of AI yet at all to suers to subscribe to, Just mark it as coming soon. For Trails yes we will enable by default of 1500 draft requests but silently, just a note somewhere saying that AI fearures are in "preview" mode … once we are done with AI Voice Bot then we can enable them from backend."** Consequences (C41): **no purchasable AI in v2.0.** The AI Assist add-on checkout and its second Razorpay subscription (SUB-11) are **deferred until the AI Voice Receptionist launch**; plan and billing pages show AI as **"Coming soon"** with no price and no buy button. During the 14-day trial the AI Scribe is on by default with a **1,500-draft trial quota**, labelled **"Preview"** with the note "AI features are in preview and not yet offered as a paid product"; no quota meter, upsell or price is shown. **Every AI safety control still applies to the preview** (a one-time **owner opt-in** with AI terms, **decided in round 3 (C48)**: "silently" means no purchase flow, upsell, meter or quota marketing, not sending patient data to Google without the clinic's consent; the opt-in is DPDP consent and protects the trust the PO explicitly wants to keep; patient objection, pseudonymisation, per-section human acceptance, Vertex `asia-south1` only, quota, kill switch), because preview prompts still reach Google. The catalogue is **fully configurable**: products with prices of several billing models (flat monthly, per unit, metered per minute or per draft, included units + overage), an availability switch (`purchasable`, `visibility`) set by SQL or the V2-13c Plans & prices screen, and the existing entitlement and metered-quota machinery (SUB §7.1, AI §6.3). Post-trial behaviour is PO-25. |
| **PO-22** ✅ | AI clinical content and patient privacy (AI D-9, D-10, D-11) | **Default accepted 2026-11-10:** no clinician sign-off, so v2.0 ships **substance-level** allergy checks only; the eval labels are Claude-reviewed under a recorded PO risk acceptance. Patient control is a notice plus an objection flag. The PO accepts Google's possible 90-day abuse-monitoring retention of pseudonymised prompts unless ZDR is granted. |
| **PO-23** ✅ | Accept the documented deviations from the PO's wording | **Accepted 2026-11-10** ("Rest all is fine"; CAPTCHA confirmed explicitly: "CAPTCHA yes add for signups"). (a) a 24 h pending-charge buffer and 4/7-day failed-debit grace, never after a cancellation, both settable to 0 (SUB-D4); (b) one trial per owner account as well as per clinic (SUB-D5); (c) base-plan features labelled "Smart Assist", not "AI", and built in TypeScript/SQL, not Python (AI D-8); (d) a minimum password length of 10 (AUTH PO-A1); (e) owner email change sends codes to both addresses (AUTH PO-A7); (f) reminder fair-use quota inside ₹1,499 (SUB-D2); (g) logical archive, 180 days counted from expiry, purge after admin approval, and expired-clinic Rx verification shows metadata only (SUB-D3/D6/D7); **(h) processing outside India** (PO-12 says "we only store in India"; storage stays in India, but these components process data elsewhere): Cloudflare Turnstile (a CAPTCHA token and the client IP/browser signals, no health data; Supabase's single CAPTCHA switch also covers sign-in, email OTP, recovery and resend, C43; AUTH §4.1); the leaked-password check (a 5-character k-anonymity SHA-1 prefix of the password; on Supabase Free the app server calls the Pwned Passwords range API itself, FT-05, and Supabase's own check takes over after the Pro upgrade; AUTH §5); Google's possible abuse-monitoring retention of pseudonymised scribe prompts for up to 90 days unless ZDR is granted (AIR-9, PO-22); WhatsApp delivery of appointment reminders and opt-in billing notices, which transits Meta (recipient phone and template parameters; DATA_HANDLING processors row); Vercel platform runtime logs (request metadata only; the structured logger never logs PII; Vercel log storage location **Unconfirmed**); GitHub Actions CI and Claude Code development sessions (code and synthetic data only, never production data; the production backup job therefore runs in AWS `ap-south-1`, not on a GitHub-hosted runner, FT-02). Error tracking is **not** on this list: errors are written PII-scrubbed to an India-resident sink (P1-25); **(i) billing notices by WhatsApp** (SUB-04, opt-in per clinic in `billing_profiles`), which are outside PO-8's "appointments only" (SUB §6.3); email stays the default channel. |
| **PO-24** ✅ (round 2; **closed in round 3**) | Production front-end hosting (Vercel plan) | **"I'll handle Vercel … don't worry about vercel."** **Closed: handled by the PO personally.** The roadmap carries no Vercel plan or terms dependency, blocker, risk or gate item (R24 closed, C45). Neutral technical notes only: the scheduler is Supabase pg_cron + pg_net (C22), functions in `bom1` (Mumbai) are desirable, and Skew Protection and log drains are used if available (PWA-05's update toast and the FT-07 in-app event tables do not depend on them). |
| **PO-25** (round 2; **open, default applies**) | AI Scribe access **after the trial ends** (no AI is sold in v2.0, PO-21) | **Default: preview access ends when the trial ends.** The scribe disappears from the consult screen, the server denies `ai.scribe`, and plan and billing pages show AI as "Coming soon"; accepted notes and their provenance stay. Alternative: paying clinics keep the 1,500-draft preview quota (one `plan_entitlements` change by SQL, no code; about ₹225 per clinic per month at the AI §6.3 estimate, and pseudonymised text keeps reaching Google for clinics that opted in). Either choice can be changed later without a deploy; single clinics can be given access with `platform.grant_override`. |
| **PO-26** (new, round 3; **confirm, default applies**) | Timing of the Supabase Pro + PITR upgrade of production | **Default: at UAT exit, before the first full-price charge** (a G7 exit criterion; in practice before the `uat` coupons' `free_until` date, SUB-D11, so the first real debit already runs on Pro + PITR), or earlier on any §9.1 trigger. The PO confirms the timing (and may choose to upgrade at UAT start instead, which removes the free-tier compensating-control risk for UAT data at about US$130/month). Staging stays on Free in its own organisation. |

Sources for this table (accessed 2026-11-10): [S-PITR] Supabase backups, https://supabase.com/docs/guides/platform/backups (PITR worst-case RPO two minutes; 7/14/28-day retention at about US$100/200/400 per month; Pro keeps 7 daily backups without PITR; PITR requires at least the Small compute add-on). [S-PRICE] Supabase pricing, https://supabase.com/pricing (Pro "starts at $25 per month"; Free projects "paused after 1 week of inactivity"; leaked-password protection not on Free). Round 2 (accessed 2026-11-10; details in VERIFICATION_LOG addendum 3): [S-FREE] Supabase pricing, backups, billing and password-security docs (Free: 500 MB database, 1 GB Storage, 5 GB egress, 2 active free projects across all organisations, pausing after a week of low activity, no automatic backups or PITR, leaked-password protection Pro and above; upgrading lifts restrictions in place); [RZP-PLAN] Razorpay Create Plan API, https://razorpay.com/docs/api/payments/subscriptions/create-plan (the plan amount is charged as given, in paise). Round 3: the Vercel pricing and Fair Use citations [V1]/[V-FU] were removed with PO-24 (handled by the PO); they remain in VERIFICATION_LOG addendum 3 as history. Coupon and refund sources are SUB §15 [S29]–[S37].

### 1.3 The ten most important items

| # | Item | Pri | Size |
|---|---|---|---|
| 1 | P0-01 Remove `sessionOverride`/`clientOverride` from every `"use server"` export (SEC-01, SEC-02) | P0 | M |
| 2 | P0-02…P0-05 Membership guard, webhook lockdown, tenant-bound share tokens, lab-orders path check | P0 | S-M + M + M + S |
| 3 | P0-10/11 Local ephemeral Supabase test lane (before the override removal) + GitHub Actions CI | P0 | M + M |
| 4 | AUTH-01/04 Password login; email OTP only for signup and forgot password; SES in Mumbai (AUTH-03) | P0/P1 | S + M + M |
| 5 | P0-12 Atomic job claim and scheduler; no duplicate sends | P0 | M |
| 6 | P1-01 + SUB-01/02 Role-aware **and subscription-aware** RLS and storage policies (the hard stop), with a pgTAP matrix | P1 | L + M + M |
| 7 | P1-05 Atomic server commands as RPCs, idempotent by `client_request_id` (PWA-06a) | P1 | L |
| 8 | P1-28/29 + PWA-01…05 Design system, installable PWA shell and live **Today** workspace | P1 | L + L + M |
| 9 | SUB-03/04/05/07/08 Razorpay AutoPay subscription (₹1,499 + GST), trial, lifecycle jobs, GST invoices, archive and purge; SUB-COUPON coupons and refunds for UAT (start KYC and GST registration, SUB-10, right after G1) | P1 | L + M + M + M + M + L |
| 10 | AI-01/03/04/05 AI containment, entitlement gating and the India-region AI Scribe (trial Preview only; no AI sold in v2.0, PO-21); Smart Assist in the base plan | P0/P1 | S + M + M + M |

**Round-2/3 additions:** FT-02 (self-run encrypted backups in India with a monthly restore drill) is a **UAT-start blocker (G6)** on the same level as items 1–10 (§9.1). The Supabase Pro + PITR upgrade and the UAT exit checklist (SUB-COUPON-08) are **paid-launch blockers (G7)**. Coupons and refunds (SUB-COUPON-01/02/04/05/07) are needed before UAT starts, because UAT testers are admitted with `uat` codes.


### 1.4 Out-of-band v1 security hotfix (conditional on PO-1)

> **Status: not triggered.** The PO confirmed on 2026-11-10 that v1 is not live and that the `.env` Supabase project is a test database (PO-1). S0, G-HF and P0-08 are therefore **not required**. The text below is kept as the contingency plan, in case v1 is ever exposed to real data before V2-01 lands. **Guardrail:** v1 must not be deployed with real patient data.

- **Recommendation (P0).** If v1 serves real clinics, do **not** wait for v2.
  1. Create `hotfix/v1-security-containment` from `main` (after tagging `v1.0-mvp-baseline`).
  2. **Before any migration (P0-16a):** confirm region, tier and PITR in the dashboard, or take a logical dump and test-restore it locally. Record the result in the G-HF evidence.
  3. Apply P0-01 to P0-05 plus P0-06 as small, surgical patches. If PO-16 finds no API consumers, also switch `/api/v1` off. An interim P0-01 is acceptable: reject any non-undefined override at the top of each exported action.
  4. Verify with a scripted manual test plan, because CI does not exist yet (C17).
  5. Deploy, then rotate the service-role key, the Supabase access token, and the MSG91, AI and CRON secrets (P0-07).

  This needs **separate PO approval (gate G-HF)** because it touches the v1 line. Whether the branch is merged back to `main` or kept as a release branch is the PO's call. Recommendation: release branch `release/v1.0.x`, with `main` untouched.
- **Recommendation (P0, ⚖).** In parallel, run **log forensics** (P0-08). Look for:
  - `Next-Action` POSTs carrying override arguments;
  - hits on `/api/webhooks/messaging/dev`;
  - `PATCH /rest/v1/memberships`;
  - cross-tenant `document_share_tokens`;
  - anomalous WhatsApp cancellations.

  Then ask counsel for a **DPDP / CERT-In assessment** of whether a reportable incident occurred. CERT-In's 6-hour clock applies once an incident is identified.
- **Recommendation (P0, unconditional).** Rotate the secrets even if PO-1 = not live. **Risk / Assumption (validate):** `.env` holds the service-role key and an account-wide `SUPABASE_ACCESS_TOKEN`, and several agent runtimes (Antigravity; OpenCode with a free third-party reviewer model, G-2) worked in this repo with no `.env` deny rules (W-02, confirmed). Exposure to third parties cannot be ruled out. P0-07 is therefore scheduled in **V2-00** as well as S0, so it cannot be skipped.
- The same fixes are re-implemented properly on `feature/v2` in phase V2-01, as code with tests rather than a copy of the hotfix.

---

## 2. Current product assessment

Detail: [PRODUCT_BASELINE.md](PRODUCT_BASELINE.md).

- **Fact.** There are 20 feature domains: appointments, patients, visits, consultation, prescriptions, labs, referrals, billing, queue, waitlist, notifications, AI, API keys, webhooks, DPDP, staff, clinics, settings, auth and terminology. That is about 61k lines of TS/TSX. Roles are owner, admin, doctor, receptionist and nurse.
- **Strengths worth preserving.** Queue tokens with triage vitals; specialty consult templates; CDCI drug search and ICD coding; versioned prescriptions with an amendment flow; the consent ledger; WhatsApp share; waitlist promotion; AI scribe; HMAC-signed outbound webhooks; the public REST v1 with an envelope.
- **Problems (verified):**

| ID | Problem | Pri |
|---|---|---|
| F2/F-01 | Receptionists cannot register patients. The app matrix blocks it; RLS and the original intent allow it. | P0 (PO-3 decided: they register) |
| F3 | Staff invitations never reach invitees in production. Tokens are not bound to the invited email. There is no revoke or resend. | P0 (→ AUTH-06) |
| F5 | No reminder producers. Webhook retries and delayed messages depend on a scheduler that does not exist. | P1 (scheduler P0) |
| F6 | Messaging governance (opt-out, consent, quiet hours, quota) is dead code. The consent UI misstates suppression. | P1 |
| F7 | Patient self-reschedule: the token insert fails on an FK, slots are generated in UTC, and slot validation is missing | P1 |
| F8 | Copilot reschedule/cancel "Confirm" does nothing but shows success | P1 (→ AI-01: copilot removed in v2.0) |
| F9 | Users with two clinic memberships are locked out of every dashboard route | P1 |
| F10 | Labs is document upload only, yet marked "verified" in v1 planning | P1 (PO-5: relabel as documents; structured labs v2.1) |
| D13 | No visit state machine. Front desk can mark a visit completed without sign-off. | P1 |
| D14 | Paid invoices stay mutable. Overpayment is allowed. There is no cancel or refund. Editing items un-cancels an invoice. | P1 |
| D15 | Silent fallbacks: the dev messaging provider and a mock AI report success in production | P1 |

- **Risk.** v1 planning records cannot be used as evidence. `06-VERIFICATION.md` reports 37/37 tests where the file has 17 (E-12). v2 accepts **only CI-produced evidence**.
- **Problem (P1, gaps raised by the PO on 2026-11-10; detail in the four new documents):**
  - No plans, pricing or billing for clinics. The v1 `subscriptions` and `payment_records` tables are never written, and the billing page is orphaned (`supabase/migrations/000002_invitations_billing.sql:29-51`, `features/billing/subscription.ts:12-46`; SUBSCRIPTIONS_AND_PLANS §2).
  - No platform admin of any kind.
  - LLM and deterministic features are both labelled "AI", and nothing gates either one (AI_STRATEGY §1.3).
  - Every staff login sends an email OTP; there are no passwords (`features/auth/dev-actions.ts:59-62`; AUTH_REDESIGN §1).
  - No PWA support: no manifest, icons, `public/` directory or service worker (PWA_STRATEGY §1).
- **Regression risks for v2** (PRODUCT_BASELINE §9.4): public token URLs already in patients' WhatsApp history; MSG91 template contracts; API v1 and webhook payloads for external consumers; invoice and queue number formats; the clinical sign and amend flow. Because v1 is not live (PO-1), these become contracts **from go-live**, not from v1.

## 3. Existing architecture assessment

Detail: [ARCHITECTURE_ASSESSMENT.md](ARCHITECTURE_ASSESSMENT.md), [DATABASE_ASSESSMENT.md](DATABASE_ASSESSMENT.md), [API_ASSESSMENT.md](API_ASSESSMENT.md).

- **Fact (corrected counts, C3–C8):**
  - Next.js 15.5.27 App Router; React 19; Supabase via `@supabase/ssr` 0.5.2.
  - 20 files carry override seams: **16** `"use server"` action modules, plus the three PDF generators and `features/dpdp/export.ts` (83–89 `sessionOverride` occurrences, depending on the pattern counted). 137 exported async functions in `features/`.
  - 15 route files under `app/api/v1` (13 data routes); 28 `route.ts` in total.
  - 43 tables, all with RLS enabled; 8 SECURITY DEFINER functions; 18 migrations.
  - **5** separate service-role client factories.
  - 191 `console.*` calls in app, features and lib (verified, F-5). 387 `as any` casts and 337 eslint-disable comments *(unverified: not in VERIFICATION_LOG)*.
- **Problems (verified):**
  - Business rules, authorisation, data access and side effects are interleaved in 500–1,300-line action files. REST v1 re-implements the rules against the service role (API-11).
  - **No transactions.** Multi-step writes are separate PostgREST calls, and errors are often ignored. Audit and outbox are written after commit, and outbox failures are swallowed (ARC-09, ARC-10).
  - RLS is tenant-only; RBAC lives only in TypeScript (SEC-06, ARC-03).
  - Child FKs are not tenant-consistent (DB-01).
  - `ON DELETE CASCADE` from visits wipes clinical and financial records (DB-03).
  - Signed records are mutable (DB-13).
  - Number generation is race-prone (D11/D12, DB-11).
  - Jobs are dispatched inline in user requests with a non-atomic claim and no scheduler (ARC-14, F-3a/b, D16).
  - Hand-written DB types omit about 10 tables *(unverified)*.
- **Strengths.** SQL-first migrations; E.164 normalisation; append-only consent; webhook signer; API key hashing with constant-time compare; audit metadata allow-list; `getUser()` server-side.

## 4. UI/UX assessment

Detail: [UX_AUDIT.md](UX_AUDIT.md), [INFORMATION_ARCHITECTURE.md](INFORMATION_ARCHITECTURE.md).

- **Facts (verified):**

| ID | Finding | Pri |
|---|---|---|
| F-02 | The queue is not live: no Realtime and no polling, despite "Real-time" copy | P1 |
| F-03 / F-04 | Walk-in and checkout chain 3 server actions from the browser, with no atomicity or idempotency. The overbook path creates duplicate patients. | P1 |
| F-05 | Five patient-creation UIs, and only one runs dedup | P1 |
| F-06 / F-07 | Staff cannot reschedule. Patient-record hand-offs drop context. | P1 |
| F-08 | Consult autosave runs every 15 s with no unload guard. The in-consult upload does nothing. | P1 |
| UX-3.2 | The queue "Start Consultation" button is shown to every role. `/consultation/[id]` has **no permission gate**, so receptionists can view clinical data. | P1 |
| F-09 | The token scale is bypassed: 937 hex classes; Inter never loaded; dead `animate-in` classes | P1 |
| F-10 / UX-3.11 | About 21 hand-rolled overlays with no focus trap; 27 `alert()`/`confirm()` calls; no combobox semantics; `aria-describedby` never used; low-contrast `gray-400` on 267 sites | P1 |
| F-11 | 0 `loading.tsx`, `error.tsx` or `not-found.tsx` files | P1 |
| F-12 | Not mobile-first: 780 px timeline, hover-only labels, 28–36 px touch targets, 14 px inputs (iOS zoom) | P1 |
| UX-12 | 29 sites compute "today" in UTC. The dashboard shows yesterday between 00:00 and 05:29 IST. | P1 |

- **Assumption (validate).** These findings come from code. No visual walkthrough was done. M0 records screenshots, axe reports and interaction counts as the baseline.
- **Recommendation.**
  - Collapse the dashboard, queue and cabin into one live **Today** workspace with front-desk, nurse and doctor modes.
  - Add a universal **Find / Add patient** command palette.
  - Rebuild the consult as a keyboard-first two-pane workspace with explicit save state.
  - Use role-based navigation (INFORMATION_ARCHITECTURE §3).
  - Interaction targets: check-in in 1 action; walk-in for an existing patient in ≤ 3 keystrokes after typing; booking ≤ 3; reschedule ≤ 4; collect ≤ 3 (FRONTEND_MIGRATION_PLAN §3).
- **Recommendation (PWA_STRATEGY §8, INFORMATION_ARCHITECTURE update).** Add the new surfaces to the IA: `/onboarding/billing` (mandate step), `/settings/billing` and `/billing/locked` (owner) and `/billing/locked/staff`, the `/platform` admin route group, and install and update entries under More/Profile.

## 5. Recommended frontend technology and design system

Detail: [FRONTEND_TECHNOLOGY_ASSESSMENT.md](FRONTEND_TECHNOLOGY_ASSESSMENT.md), [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md), [FRONTEND_MIGRATION_PLAN.md](FRONTEND_MIGRATION_PLAN.md).

| # | Area | Recommendation | Pri |
|---|---|---|---|
| FE-1 | Framework | **Keep Next.js App Router.** Scored 44 against Vite SPA 33, RR7 39 and TanStack Start 32. **Decision (C24):** patch to the latest **15.5.x now** (P0-06). Evaluate **Next 16** (`middleware` → `proxy`) as a separate PR in V2-03. The decision is a dependency of plan 06-02 (primitives) (P2). | P0 / P2 |
| FE-2 | Components | **shadcn/ui open-code on Radix**, styled with v2 tokens. `cmdk`, `react-day-picker`, `sonner`, TanStack Table. Fallback: Base UI or React Aria per component behind the same API. | P1 |
| FE-3 | Design system | **"Clinic Paper"**: teal accent, warm neutrals, IBM Plex, tabular numerals, en-IN and IST conventions, healthcare patterns (identity header, allergy banner, token chip, Rx line). Enforced by CI grep guards and a palette reset. | P1 |
| FE-4 | Forms | react-hook-form + **zod 4** shared schemas, with server actions as the submit target | P1 |
| FE-5 | Data | RSC reads + server actions + optimistic UI. **GET route handlers for typeahead search.** Supabase **Realtime** for Today, with a polling fallback and a two-tenant isolation test. TanStack Query deferred. | P1 |
| FE-6 | Dates / money | `lib/datetime` (tenant TZ, default Asia/Kolkata) and `lib/money` (exact, en-IN). **Decision (C25):** the DB stays `NUMERIC(10,2)` rupees; `lib/money` converts at the boundary; no paise migration without a new ADR. FRONTEND PR-9 is amended. | P1 |
| FE-7 | Writes | The UI depends on **one atomic server command per business action**, never a client-side chain (C18) | P1 |
| FE-8 | Gallery and tests | `/dev/ui` gallery + Playwright screenshots + axe. No Storybook. | P2 |
| FE-9 | Performance | Route and Lighthouse budgets per PWA_STRATEGY §3.9 (report-only nightly, blocking at V2-15). The copilot drawer is removed (AI-01), so there is no drawer to lazy-load. | P2 |
| FE-10 | Deferred | v2.0 keeps an **in-memory** stale view only. A persisted offline Today needs a DPDP review and moves to v2.1 (PWA-13). Hindi/regional i18n scaffolding (P3). | P3 |
| FE-11 | PWA | **Installable PWA** (PWA_STRATEGY): `app/manifest.ts`, icons, a hand-written service worker of about 100 lines that caches only allowlisted static assets and the offline page, **no PHI on the device**, `hardSignOut()` for every exit path, a safe-area/`dvh` standalone shell, tablet two-pane layouts, an Android install prompt and an iOS instruction sheet, and idempotent retries. No native apps and no web push in v2.0. | P1 |

- **Risk.** Behaviour regressions while rebuilding the 1,681-line consult and the 1,029-line checkout. **Mitigation:** outcome-based characterisation e2e on v1 **before** any rebuild (M0, which requires P0-10).
- **Problem (documentation).** UX deliverables include only ASCII wireframes, and no design-skill exploration was done (prompt B3). **Decision (revised after review):** this is closed in prompt Phase 2, not in V2-06. Phase **V2-DX** produces a rendered token palette, high-fidelity mock-ups or interactive prototypes of Today and Consult at 360 and 1280 px, and the design-skill exploration. The PO approves them at the design sub-gate **G2-D**, before any primitives are built (plan 06-02).

## 6. Target backend architecture

Detail: [TARGET_ARCHITECTURE.md](TARGET_ARCHITECTURE.md), [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) (ADR-001 to ADR-019).

- **Recommendation.** A **modular monolith** on Next.js + Supabase Postgres, Auth and Storage (ADR-001, ADR-017). No microservices and no worker fleet.
  - Each domain follows the contract `schema → policy → service → repo`, with thin `actions` and `api` adapters (ADR-002).
  - One DB transaction per command, with audit and outbox written inside it (ADR-004). The transaction is a plpgsql RPC per flow (C18).
  - Database-enforced invariants: composite tenant FKs, CHECK and exclusion constraints (including a `btree_gist` no-double-booking constraint, DB-08), immutability triggers (ADR-006, ADR-015).
  - Transactional outbox and job queue with `SKIP LOCKED` claims on a scheduler (ADR-009).
  - Standard `Result`/`AppError` and envelopes (ADR-007).
  - Generated types and zod v4 contracts; OpenAPI generated (ADR-008).
  - Structured logs, request IDs, error tracking (ADR-012). **Error sink is India-resident (PO-12):** PII-scrubbed error events are written to an `ops.error_events` table in the Mumbai Supabase project (short retention, alerting through the V2-04 alert route) and, from V2-15, also to the India log drain. No third-party error-tracking vendor outside India; adding one later needs explicit PO acceptance under PO-23(h).
- **Decisions on contradictions:**

| # | Topic | Decision |
|---|---|---|
| C18 | Atomic multi-step writes | **Decided (revised after review): RPC-per-flow.** The 8 atomic commands are plpgsql functions, `SECURITY INVOKER` under RLS, called through supabase-js, with audit and outbox written inside them. Generated Supabase types (P1-34) remove most `as any` casts without a second data layer. **Kysely + `DATABASE_URL` + `withTenantTx` (ADR-003) is superseded**: revisit only if RPCs prove unmaintainable, through a new ADR. A short **D1 confirmation spike** in **V2-03** (before V2-05) proves one flow end to end: RLS, `auth.uid()` as actor, audit and outbox in one transaction, and the error mapping to `AppError`. |
| C19 | Role-aware RLS design | **ADR-006 (amended, simplified):** `has_permission(tenant, perm)` is a STABLE SQL function with a hard-coded `CASE` over the 5 fixed roles. No `role_permissions` table, join or codegen. A unit test asserts parity with `lib/permissions/matrix.ts`, and the pgTAP matrix tests the policies. A table is introduced only if per-tenant custom roles are approved later. |
| C20 | Service-role allow-list | **ADR-005's list** (`lib/jobs/**`, `features/*/system.ts`, `app/api/{jobs,webhooks}/**`), with one `getSystemDb(reason)` factory replacing all **5** current factories. Public token flows move to SECURITY DEFINER RPCs. `/api/v1` moves off the service role per the amended ADR-011 (row below). Enforcement uses **one** mechanism, ESLint `no-restricted-imports` (P1-34); the Semgrep rule in SECURITY_VERIFICATION_PLAN is dropped. |
| C21 | Rate-limit store | **Postgres** (ADR-010), with no new vendor. Public token routes are limited in the route handler through an RPC. Upstash is used only if load tests require it. |
| C22 | Scheduler | **pg_cron + pg_net** calling `/api/jobs/run`, defined in a migration so it is visible in the repo and independent of the Vercel plan. Vercel Cron is not used; pg_cron keeps the schedule in the database, next to the data it acts on. |
| C23 | Object storage | **Supabase Storage only** for clinical documents (ADR-014). The R2/S3 path is removed (P1-43, ARC-19). The backup bucket (India region) is a separate infrastructure decision (§9). |
| ADR-011 | API keys under RLS | **Amended (no `withTenantTx`).** An `api_authenticate(key)` SECURITY DEFINER RPC verifies the hashed key and returns the principal (tenant, scopes, owning membership). Data access then uses either explicit per-endpoint RPCs that take the principal and enforce tenant and scope in SQL, or RLS through a short-lived JWT minted for the key principal. The JWT option needs the project's JWT signing secret, so it is chosen at G2 only if it is simpler than RPCs. If PO-16 finds no API consumers, this whole item is P2 and `/api/v1` stays disabled. |
| C25 | Money | `NUMERIC(10,2)` retained (§5 FE-6) |

- **New modules (2026-11-10).** These stay inside the same monolith:
  - **Billing (SUB).** `lib/billing/provider.ts` holds the `BillingProvider` interface, with Razorpay and Fake adapters. Webhooks arrive at `app/api/webhooks/razorpay`. Access and entitlement functions live in the non-exposed `billing_internal` schema, with caller-bound `public.my_*` wrappers. Plan, price and entitlement tables are configured by SQL RPCs first and, from V2-13c, from the admin portal's Plans & prices screen (same RPCs).
  - **Platform admin.** The admin portal is the `(platform)` route group in the same app. `platform.*` SECURITY DEFINER RPCs require `is_platform_admin()` at aal2. There is no service role in request paths and no clinical-data access.
  - **AI.** `lib/integrations/ai` is the gateway, with a Vertex `asia-south1` adapter behind `AiProvider`.
  - **Email.** Amazon SES (`ap-south-1`) sends through the Supabase Send Email hook and an SES API sender for app mail.

  Each module gets an ADR at G2.
- **Decision.** No direct `DATABASE_URL` and no new privileged database secret are introduced in v2.0. The service-role key stays confined to ADR-005's allow-list.
- **Errata needed (P2-DOC).** ARCHITECTURE_DECISIONS: ADR-003 superseded; ADR-006 and ADR-011 amended as above.

## 7. Security and privacy findings

Detail: [SECURITY_ASSESSMENT.md](SECURITY_ASSESSMENT.md), [THREAT_MODEL.md](THREAT_MODEL.md), [DATA_HANDLING.md](DATA_HANDLING.md), [SECURITY_REMEDIATION_PLAN.md](SECURITY_REMEDIATION_PLAN.md), [SECURITY_VERIFICATION_PLAN.md](SECURITY_VERIFICATION_PLAN.md). Corrected claims: [VERIFICATION_LOG.md §1.1](VERIFICATION_LOG.md).

**Critical and High (verified, final ruling):**

| ID | Finding (corrected) | Sev | Pri |
|---|---|---|---|
| SEC-01 / ARC-01 / F1 | `sessionOverride` gives unauthenticated, cross-tenant, service-role patient search and writes to settings and consent in **4 confirmed browser-reachable actions** (`searchPatients`, `updateClinicSettings`, `updateStatutorySettings`, `toggleGlobalConsent`), given a tenant UUID (which leaks through storage URLs). `getPatient`/`getPatients` are pending OI-6 (C31). | Critical | P0 |
| SEC-03 / ARC-02 / SEC-08 | Any member can self-promote to owner. Admins can mint owner invites. Invitations are not bound to an email address. | Critical | P0 |
| SEC-04 / SEC-19 / D9 | The messaging webhook accepts `dev` and unknown providers with no environment gate, and Twilio on header presence alone. A cross-tenant phone `ilike` lookup lets unauthenticated callers confirm or cancel any appointment. `.or()` filter injection is possible. | Critical | P0 |
| SEC-02 | 83 override sites let any member forge their role and actor, which forges clinical signatures and audit actors (within the tenant) | High | P0 |
| SEC-05 / ARC-05 | Share tokens are not tenant-bound: lab reports, Rx PDFs and patient names leak across tenants. Reschedule routes can be abused. (Invoice PDFs do not leak.) | High | P0 |
| ARC-06 | `POST /api/v1/lab-orders` accepts any `storage_path`, so a cross-tenant signed URL is possible. **This was missing from SECURITY_ASSESSMENT (C1).** | High | P0 |
| SEC-24 | 10 production vulnerabilities: next (critical/high, patch available in 15.5.x), zod (major), AI SDK chain (6 vulnerabilities, major) | High | P0 patch / P1 majors |
| SEC-25 / E-1 | Tests use the service-role key against a hosted project that may be production | High (Critical if prod) | P0 |
| SEC-06 / F4 / ARC-03 | RLS is tenant-only. Receptionists can read and **update** clinical notes and prescriptions through PostgREST. `audit_logs` can be forged. Comms and notification tables are `FOR ALL`. | High | **P1** (C13) |
| SEC-07 / API-11 | No staff offboarding. API keys outlive their creator, act as admin and have no scopes. | High | P1 |
| ARC-07 | The referral receiver can rewrite any column. The sender can address any tenant. | High | P1 |
| DB-01, DB-03, DB-13 | Tenant-inconsistent FKs; CASCADE deletes of clinical and financial data; mutable signed records | High | P1 |
| API-15 | Receptionists can export a full medical record (`exports:create` is unused) | High | P1 |
| UX-3.2 | `/consultation/[id]` has no permission gate | High | P1 |
| DB-21 / SEC-30 | Erasure is a flag only; there is no retention or purge job; PII remains in queues and storage | High / Medium | P1 |

**Medium (P1 unless stated):** SEC-13 headers; SEC-14 dev OTP shortcut (reachable `next dev` with a real key); SEC-15/D15 silent dev providers; SEC-16 AI PII and prompt injection; SEC-18 overwritable finalised PDFs and deletable lab docs; D4 dead unauthenticated `notifyPrescriptionIssued` (delete in P0-01); SEC-09 / ARC-04 SECURITY DEFINER without a tenant check (**P2**, metadata-only); F-8 per-instance rate limiter (**P2**) plus an OTP throttle (P1); F-7 account-scoped access token in the app `.env` (P1).

**Not independently verified** (carried from SECURITY_ASSESSMENT; validate before scheduling): SEC-10 SSRF via redirects/DNS rebinding, SEC-11 public-route rate limits, SEC-12 key expiry, SEC-17 open redirect, SEC-20 to SEC-23, SEC-26 MFA and sessions, SEC-27 to SEC-29, SEC-33. These enter the backlog as P1/P2 items marked "(unverified)".

**Privacy and compliance ⚖:**
- **Decision (C28, updated for PO-12).** DATA_HANDLING §5 is the **single retention schedule**. It is now extended by the tenant data lifecycle in SUBSCRIPTIONS_AND_PLANS §6: 30 days locked after expiry, then a logical archive, and a purge of clinic data at expiry + 180 days. The platform's own statutory records survive the purge: SaaS GST invoices for 72 months, and logs for at least 1 year. Because no counsel is engaged, the **PO approves the schedule** at G1 and again before V2-13. Both log rules apply: security logs ≥ 180 days in India (CERT-In) **and** audit logs ≥ 1 year.
- **Decision (C29).** Clinical-record retention is grounded in IMC 2002 reg. 1.3.1 and state rules, not "NMC 3 years". DATABASE §7 receives an erratum.
- **Assumption (validate).** clinicOS is likely the processor and clinics the fiduciaries under DPDP. With no counsel (PO-12), the Terms drafted in SUB-10 state this, and the PO accepts it as a recorded risk (R22).
- **Sub-processors after the 2026-11-10 decisions:** Supabase (Mumbai), Vercel (`bom1` functions), Amazon SES (`ap-south-1`), MSG91, Razorpay, and Google Vertex AI (`asia-south1` regional endpoint, pseudonymised scribe text only). Google's possible 90-day abuse-monitoring retention is risk AIR-9 (PO-22).
- Outstanding: provider DPAs (Google, MSG91, Razorpay, AWS), PO acceptance of the remaining processing outside India (PO-23(h); error tracking is India-resident, C39), and the CERT-In incident process (P1-38).

## 8. Testing strategy

Detail: [TEST_STRATEGY.md](TEST_STRATEGY.md), [SECURITY_VERIFICATION_PLAN.md](SECURITY_VERIFICATION_PLAN.md).

- **Facts.**
  - 69 spec files and 649 cases. In isolation: 442 pass, 206 are skipped, and 27 files fail because they need the hosted DB.
  - No e2e, a11y, visual or coverage tooling; `tests/e2e` does not exist.
  - Tests are not type-checked.
  - No teardown, so orphan users accumulate (E-2).
  - Cross-tenant DB tests **do** exist for the main clinical tables, but there are **no role-within-tenant DB tests**, and the RLS catalog check covers only 8 tables (E-4).
  - Some tests copy logic or rely on mocks for "isolation" (E-5).
  - AI evals run a regex parser, not the model (E-6).
- **Recommendation (layers):**
  1. Unit tests (Vitest).
  2. DB integration on a **local ephemeral Supabase** (`supabase start`, migrations, synthetic seed, run-scoped teardown, a guard that refuses non-local URLs).
  3. A **pgTAP RLS matrix** generated over all tenant tables × CRUD × roles × {own, other, none}.
  4. An **authentication/permission guard test** enumerating every server action and route handler.
  5. MSW contracts for MSG91 and AI.
  6. **Playwright + axe** for 10 critical journeys on the device matrix (PWA §9.1).
  7. Concurrency tests for booking, tokens, outbox and payments.
  8. Nightly: full e2e, live AI evals with a sandbox key, ZAP baseline.
  9. Pre-release: k6 load test plus a restore drill.
- **Gates.** The PR lane blocks on 0 failures and **0 skipped in the DB lane**. Verification evidence is CI run links only; hand-typed counts are rejected.
- **Decision.** Journey 8 (role restrictions) and the SECURITY_VERIFICATION §6 matrix are finalised with PO-3: receptionists register, book and collect, with no clinical notes.
- **Additions from the new tracks.** The RLS matrix gains a subscription-access dimension (`full`, `onboarding`, `locked`, `none`). Time-travel pgTAP tests use `p_now` for the trial, grace, expiry, archive and purge. Razorpay test mode and a `FakeBillingProvider` support webhook contract tests. Mailpit covers the signup, reset and invite journeys; journey 1 becomes **password login**. The Playwright device matrix covers phones and tablets, with PWA specs 1–11, including the cache audit and the lock-while-open check. AI eval lanes L1–L3 replace the regex "evals".
- **Assumption (validate).** Coverage ≥ 80% lines / ≥ 70% branches on domain modules and p95 < 1.5 s are proposals to confirm at G2. They are not facts.

## 9. Infrastructure recommendations

Detail: [INFRASTRUCTURE_ASSESSMENT.md](INFRASTRUCTURE_ASSESSMENT.md).

| Area | Recommendation | Pri |
|---|---|---|
| Environments | Local (`supabase start`, synthetic, Mailpit, Fake billing) → Preview + Staging (staging Supabase on the **Free plan in its own organisation**, Mumbai, synthetic, Razorpay **test mode**, SES; Vercel per the PO (PO-24 closed); **built in V2-03**, FT-01) → Production (**built in V2-15**, PO-15) (Mumbai `ap-south-1`, **Supabase Free during the UAT stage (V2-16; PO-17 as scoped by round 3), then Pro + PITR 7 days in place at UAT exit, before full-price charging** (§9.1, PO-26), network restrictions and SSL enforcement where the Free plan offers them (**Unconfirmed**), MFA on every provider account, Razorpay **live mode** (UAT testers authorise real mandates with `uat` coupons, SUB §14.8), Vercel front end managed by the PO with functions in `bom1`). **Decision (C26, resolved by PO-1):** create a **new** production project built from the v2 migrations; keep the current project as the shared test project until the local harness replaces it, then retire it; it **must be paused or deleted before staging is created in V2-03** (2-active-free-project cap, FT-01). | P0 decision / P1 build |
| CI/CD | GitHub Actions: static → secrets/deps audit → unit → DB lane (local Supabase + pgTAP) → build → e2e smoke + axe. Protect `main` and `feature/v2`. CODEOWNERS on migrations, permissions, middleware and the Supabase lib. Approval-gated production migrations + drift check. | P0 (pipeline) / P1 (deploy jobs) |
| Secrets | Complete zod env schema that fails at boot; no silent fallbacks. Secrets in Vercel and GitHub Environments only. Remove `SUPABASE_ACCESS_TOKEN` from the app `.env`. Rotate keys unconditionally (P0-07, V2-00) and again after containment if v1 is live. gitleaks. | P0 (rotation) / P1 |
| Jobs | Atomic claim (`FOR UPDATE SKIP LOCKED` + lease), reaper for stuck `processing` rows, scheduler per C22, remove inline dispatch; dead-letter and queue-lag alerts | P0 |
| Observability | Error tracking with PII scrubbing into an **India-resident sink** (`ops.error_events` in the Mumbai Supabase project; PO-12, §6), structured logger replacing `console.*`, and request IDs **from V2-03**. Alerts in V2-04, plus billing-reconciliation divergence and Send Email hook failure alerts in V2-13b. External uptime on `/api/health` and `/api/ready`, and a log drain to India storage with ≥ 180-day retention, in V2-15 (a front-end log drain if available; Supabase log export needs the Pro upgrade, **Unconfirmed**). **Free-tier note:** Supabase Free keeps API/DB logs 1 day and auth audit logs 1 hour, and platform runtime logs are short-lived, so security and audit events go to the app's own India-resident tables (FT-07) and never depend on platform log retention. | P1 |
| Email | **Amazon SES `ap-south-1`** through the Supabase Send Email hook (custom SMTP as fallback) for Auth codes, plus an SES API sender for invites and billing notices. DKIM, SPF and DMARC on a dedicated `auth.` subdomain. Sandbox exit is requested early (AUTH-03). Custom SMTP and the Send Email hook both work on Supabase Free; the default custom-SMTP email limit (30/h) is raised in the dashboard. | P1 |
| Payments | Razorpay webhooks at `app/api/webhooks/razorpay`: HMAC verification, event-ID dedupe, processing through the job queue, and a daily reconcile job. Test mode on staging; live mode only in production (SUB-03, SUB-04). | P1 |
| Lifecycle cron | pg_cron schedules `lifecycle_tick` (state tidy-up, share-token revocation), `reconcile`, `notify_upcoming`, the export job, `retention_sweep`, archive and purge (dry-run, then admin approval), and `ai.reservations_cleanup`, plus the FT-03 heartbeat and FT-04 quota check. pg_cron + pg_net is the **only** scheduler (C22). That both extensions are available on the Free plan is confirmed on staging in V2-04 (**Assumption (validate)**). Access never depends on a job having run (SUB §6.2). | P1 |
| AI | Vertex AI on the regional `asia-south1` endpoint only; caching and request-response logging off; GCP budget alert and Vertex quota; kill switch (AI-17). | P1 |
| Backup and DR | **Before any migration on the hosted test project** (V2-00): verify its region, tier and backups, or take a logical dump and test-restore it locally (P0-16a). Merge the two runbooks and remove unverified claims (Frankfurt replica). **Free-tier mode (UAT stage, PO-17 as scoped by round 3):** Supabase Free has no automatic backups and no PITR, so **FT-02** runs encrypted logical dumps (schema, data, roles, plus Storage objects) **twice a day** from a scheduled task in AWS `ap-south-1` into a versioned S3 bucket in `ap-south-1` with 30-day retention: **RPO ≤ 12 h**, **RTO ≤ 4 h** (**Assumption (validate)** in the drill), and a **monthly restore drill** into a local stack logged in VERIFICATION_LOG. After the Pro upgrade at UAT exit, PITR (7 days, RPO about 2 min) is added and the dumps continue as the off-platform copy. **A restore drill must pass before UAT starts (G6) and again before paid launch (G7, with PITR).** | P0 (dumps + drill before UAT start) / P1 (automation) |
| Free-tier operating mode | Limits, compensating controls, upgrade triggers and procedure for the UAT stage in §9.1 (PO-17, PO-26) | P0 (UAT start) |
| Dependencies | Dependabot (grouped weekly; security immediately); pin Node LTS; `npm audit --omit=dev` gate at high | P1 |
| Incident response | One-page runbook; CERT-In 6-hour reporting template ⚖; DPDP breach template; `security.txt` | P1 |

### 9.1 Free-tier operating mode: UAT stage only (PO-17, scoped by round 3)

**Decision (PO-17 ✅, scoped by round 3, C46):** the free tiers apply **only to the real-world UAT stage (V2-16)** that follows the completion of all of v2: tester clinics use production free of charge through `uat` coupon codes (refunds only as the exception, SUB §14.8). **Paid launch (charging full-price customers) follows UAT** at gate G7, and the Supabase Pro + PITR upgrade is a UAT exit criterion (default timing; PO confirms in PO-26). The compensating controls below stay mandatory for the whole UAT stage, because UAT clinics may enter real patient data. Facts below were checked on 2026-11-10 and are cited in VERIFICATION_LOG addendum 3.

**Vercel.** Handled by the PO personally (PO-24 closed, C45). Neutral technical notes only: functions in `bom1` (Mumbai) are desirable and set in `vercel.json`; the scheduler is Supabase pg_cron + pg_net, so nothing depends on Vercel Cron (C22); the pre-release k6 run on staging (TEST_STRATEGY §9 item 8) also counts toward Supabase Free egress, so its duration and volume are capped.

**Supabase Free: limits and compensating controls.**

| Free-plan limit (Fact) | Effect | Compensating control | Item |
|---|---|---|---|
| No automatic backups, no PITR | Data loss back to the last copy; no point-in-time recovery | Encrypted logical dumps twice a day from AWS `ap-south-1` (age encryption before upload, SSE-KMS, versioned bucket, 30 days; bucket lifecycle: expire current versions at 30 days and noncurrent versions 1 day after they become noncurrent, and remove expired delete markers; the FT-02 acceptance check verifies this rule); Storage objects synced; an on-demand dump before every production migration and every purge batch; monthly restore drill into a local stack, logged | FT-02 |
| Pausing after a week of low database activity (warning email first; restorable for a year) | Staging, or production in a quiet week, goes offline | pg_cron heartbeat writing a row every 6 h (Supabase staff say pg_cron activity counts, **Assumption (validate)**); daily use by the pilot clinics; pause warnings go to the PO's monitored inbox | FT-03 |
| 500 MB database, 1 GB Storage, 5 GB egress (+5 GB cached), 50,000 MAU, 500K Edge Function calls, shared CPU with 500 MB RAM | Going over a quota leads, after one grace period, to pausing, a read-only database or **402 responses for every project in the organisation** | Weekly quota job (database size, Storage bytes and MAU from SQL; egress read from the dashboard by the PO) alerting at 60 % (an upgrade trigger) and 70 %; client-side image compression for uploads; Rx PDFs regenerated on demand rather than stored where possible (decided in V2-09c); staging and production in separate organisations | FT-04, FT-01 |
| 2 active free projects across all organisations the PO owns or administers | Production + staging use both; no hosted dev project and no spare restore target | Dev and CI use the local stack (P0-10); the v1 test project is paused or deleted before staging is created; restore drills target a local stack | FT-01 |
| No leaked-password (HIBP) protection | Breached passwords are accepted | The app server checks every new password against the Pwned Passwords range API (k-anonymity) in the signup, invite, reset and change-password actions; minimum length 10 stays in the Supabase config; Supabase's check is switched on after the upgrade | FT-05 (with AUTH-04b) |
| No session time-box or inactivity timeout (Pro settings) | AUTH-D2 (7 d / 14 d) cannot be set in Supabase | App-side check in the server guard signs the user out when the Auth session is older than 14 days or idle for more than 7 days; Supabase settings take over after the upgrade | FT-06 (with AUTH-09) |
| Logs: API/DB 1 day, auth audit 1 hour; no log drain | No forensic trail; CERT-In expects 180-day logs | Auth, platform-admin, billing-webhook and error events written to app tables in Postgres (`audit_logs`, the AUTH-09 auth audit, `ops.error_events`), kept ≥ 180 days within a size budget | FT-07 (with P1-25) |
| Built-in auth email: project team only, 2 per hour | Real users cannot sign up or reset | Custom SMTP or the Send Email hook through SES (both allowed on Free); email rate limit raised from the 30/h default | AUTH-03 (unchanged) |
| No uptime SLA, no custom domain (Auth URLs stay on `*.supabase.co`), no branching, no SOC 2 report | Lower assurance | Uptime monitor (P1-25); the `auth.` subdomain is used as the email sender only (PO-19); accepted for the free-tier window (R28) | — |
| pg_cron/pg_net plan availability not stated in Supabase's docs | The scheduler could be missing | Confirmed on the staging Free project before the V2-04 scheduler migration merges | V2-04 |

**Upgrade timing and triggers.** **Planned upgrade (default, PO-26):** production is upgraded to Supabase Pro + PITR **at UAT exit, before the first full-price charge** (before the `uat` coupons' `free_until` date, SUB-D11), and G7 cannot pass without it. **Early-upgrade triggers during UAT:** any one of these means production is upgraded within 7 days, and the PO records the decision:
1. Any quota at 60 % or more (database 300 MB, Storage 600 MB, egress 3 GB in a month, MAU 30,000), or any quota-grace or pause-warning email for production.
2. Any data-loss-intolerant use: a UAT clinic stops keeping its own paper or parallel record, or needs an RPO below 12 h.
3. Two consecutive failed backup runs, or a failed monthly restore drill.
4. A security incident that needs platform logs older than one day.
5. UAT is extended beyond the planned exit date, or more UAT clinics are admitted than the PO-13 pilot of 5 (the PO decides whether to upgrade instead). **An extension also needs the G7-slip runbook** (below), because the `uat` coupons' `start_at` is fixed at signup.

**If paid launch (G7) slips past the UAT exit date (addendum 4, fix 4).** `uat` codes fix `start_at = free_until` at signup and UPI subscriptions cannot be updated, so testers would otherwise be debited automatically, possibly without a GSTIN. G7 must pass **at least 5 days before the earliest `free_until`** (before the T-3 notices). If it will not, the PO runs the **slip runbook before T-3** (SUB §14.8, SUB-COUPON-08): grant `comp_until` (the new date) and cancel each affected subscription before its first debit; testers re-confirm AutoPay at paid launch (alternative: the owner "Re-confirm AutoPay" task with a later `start_at`). **No debit may run without a GSTIN.**

**Upgrade procedure** (runbook `docs/runbooks/free-tier-upgrade.md`, written in V2-15, FT-08; executed in V2-16 at the latest):
1. Take and verify an on-demand dump (FT-02).
2. Upgrade the production organisation to Pro in its billing settings. This is in place, and Supabase says it lifts usage restrictions immediately; no migration.
3. Upgrade compute to at least **Small** (required for PITR; causes a short restart, so schedule it outside OPD hours).
4. Enable the PITR add-on (7 days) and confirm that daily backups are listed.
5. Turn on leaked-password protection and the session time-box and inactivity settings (AUTH §4.1). FT-05/FT-06 stay as defence in depth or are removed in a follow-up PR.
6. Configure log retention or a drain if affordable, and re-run the hosted-settings drift check (AUTH-02).
7. Keep the FT-02 dumps running as the off-platform copy.
8. Run a restore drill that uses PITR, then update §17 (paid-launch checklist), the backup runbook (RPO about 2 min with PITR) and VERIFICATION_LOG. Staging stays on Free in its own organisation.

Indicative cost after the upgrade: Supabase Pro US$25 + Small compute about US$15 − US$10 credit + PITR 7 days about US$100 ≈ **US$130/month** [S-PITR] (PITR needs at least Small compute [S-PITR]). Vercel costs sit with the PO (PO-24 closed).

## 10. Prioritised technical debt (single backlog)

Every item traces to a verified finding in VERIFICATION_LOG, unless it is marked *(unverified)* or *(enabler)*. Items from the four new design documents (SUB, AI, AUTH, PWA) are listed in §10.2 and trace to those documents. ~~Struck-through~~ items are superseded; their replacement is named. **Depends on** lists prerequisites (item IDs or PO decisions). Sizes are relative (§14).

### 10.1 Backlog

| ID | Item | Workstream | Evidence / doc | Size | Depends on | Phase |
|---|---|---|---|---|---|---|
| **P0-01** | Remove all `*Override` params from `"use server"` exports; move logic to `server-only` services; delete `notifyPrescriptionIssued`; AST/grep lint rule | Security / Backend | SEC-01, SEC-02, F1, D4; BACKEND A1; SEC-REM P0-1 | M | — | S0 (interim), V2-01 |
| **P0-02** | `memberships` column REVOKE + `change_member_role` RPC with last-owner guard; owner/admin invites owner-only; (ride-along) SECURITY DEFINER tenant checks + `REVOKE … FROM anon` | Security / DB | SEC-03, SEC-08, ARC-02, SEC-09; BACKEND A2, A5 | S-M | — | S0, V2-01 |
| **P0-03** | Webhook lockdown: remove/env-gate the `dev`, Twilio and unknown providers (default deny); MSG91 header secret with `timingSafeEqual`; route only via `replyMsgId`; `.eq` not `.or`; no IDs or tokens in responses | Security / Backend | SEC-04, SEC-19, SEC-15, D9; SEC-REM P0-3 | M | — | S0, V2-01 |
| **P0-04** | Share tokens: tenant + `resource_type` binding on `/api/r`, `/r`, `/api/reschedule`, `/reschedule`, `/api/reports/view`, `/reports/view`; tokens created via an RPC verifying ownership; SELECT-only policy; fix the reschedule token (`resource_type`, `created_by`) | Security / DB | SEC-05, ARC-05, F7(a); SEC-REM P0-4 | M | — | S0, V2-01 |
| **P0-05** | Lab-orders `storage_path` must start with the caller's tenant prefix; zod body validation | Security / API | ARC-06; BACKEND A4 | S | — | S0, V2-01 |
| **P0-06** | Patch `next` to the latest 15.5.x (fixes the Server Actions DoS and bundled postcss) | Platform | SEC-24, FTA-D2 | S | — | S0, V2-01 |
| **P0-07** | Confirm the hosted project (PO-1); stop tests against it. **Rotate unconditionally** the service-role key, the account-wide access token, and the MSG91, AI and CRON secrets (agent-exposure risk, W-02/G-2). If PO-1 = live, rotate again after the S0 deploy. | Ops | SEC-25, E-1, F-7, W-02 | S | PO-1 | V2-00, S0 |
| **P0-08** | ~~*(Conditional on PO-1 = live.)*~~ **Not required: PO-1 = not live (2026-11-10).** Log forensics + DPDP/CERT-In assessment with counsel ⚖ | Ops / Legal | SEC-REM P0-7; OI-10 | M | PO-1, PO-12 | S0 |
| **P0-09** | Agent safety: Claude Code `permissions.deny` for `.env*`; replace `.planning/config.json` (`allow_default_branch_commits: false`, protected `main`, phase branches, independent reviewer) | Workflow | W-02, G-1; GSD W-01/W-02 | S | — | V2-00 |
| **P0-10** | Local ephemeral Supabase test lane: `.env.test`, global guard refusing non-local URLs, stop loading `.env` in Vitest, migrations + synthetic seed, run the existing 27 DB-backed suites on the local stack | QA | E-1, TEST-ES-3, SEC-25; T-01, T-06 | M | — (harness first; the existing suites are ported unchanged and still use the override seams until V2-01 rewires them) | V2-01a |
| **P0-11** | GitHub Actions PR pipeline (typecheck, lint with tooling dirs ignored, unit, DB lane, build, audit gate, gitleaks) + branch protection + CODEOWNERS | QA / Infra | E-13, F-6; I-03, T-03 | M | P0-10 | V2-02 |
| **P0-12** | Atomic job claim + lease + reaper; scheduler per C22; remove inline `dispatchPendingQueue` and fire-and-forget webhook dispatch; webhook idempotency | Backend / Infra | F-3a, F-3b, ARC-14, D16; I-04, BACKEND F1-F2 | M | PO-6 | V2-04 |
| **P0-13** | Auth/permission guard test over every server action and route handler + regression tests for P0-01 to P0-05 | QA / Security | SEC-01…05; T-05; SEC-VERIF §5-6 | M | P0-10 | V2-02 |
| **P0-14** | Role matrix alignment: **receptionist registration (PO-3 ✅)** in the matrix, RLS, UI and journey 8, with server-side dedup (AI-14) | Product / Security | F2, F-01; UX-01 | S | PO-3 ✅ | V2-05 (backend), V2-08 (UI) |
| ~~**P0-15**~~ | ~~Staff invite delivery~~ **Replaced by AUTH-06** (invitations v2: SES email, link + set password, email-bound, revoke/resend) | Product / Backend | F3, SEC-08 | — | — | see AUTH-06 |
| **P0-16a** | **Before any migration on the hosted project:** confirm region, tier and PITR, or take a logical dump and test-restore it locally | Infra | F-4; I-01 | S | PO-1, PO-7 | V2-00 (test project); production starts empty with the FT-02 backup job live (PITR only after the Pro upgrade, §9.1) |
| **P0-16b** | Consolidate the backup runbooks; **restore drill passed before UAT start** (on free tiers: restore of an FT-02 production dump into a local stack) and **again before paid launch** (PITR restore after the Pro upgrade) | Infra | F-4; I-05 | M | P0-16a, PO-17 ✅, FT-02 | V2-15 (G6 drill), V2-16 (G7 drill) |
| P1-01 | Role-aware RLS (ADR-006) for all clinical, financial and comms tables + generated pgTAP matrix covering 100% of tenant tables | Security / DB | SEC-06, F4, ARC-03, E-4; T-04 | L | PO-3, P0-02, P0-10 | V2-05 |
| P1-02 | Composite `(tenant_id, id)` FKs (NOT VALID → diagnose → VALIDATE); `prescription_items.tenant_id` | DB | DB-01; BACKEND C1-C3 | M | Diagnostics run, P1-34 B1 drift baseline (plan 03-03), P0-16a | V2-05 |
| P1-03 | Clinical immutability: triggers on signed rows + amendment RPC; write-once PDFs (`upsert:false`, versioned path, SHA-256); no member DELETE on lab docs; interim API PATCH guard | Security / Clinical | DB-13, SEC-18; ADR-015; BACKEND A6, E2 | M-L | P1-01 | V2-09a |
| P1-04 | Audit v2: actor forced from `auth.uid()`, written inside the tx; revoke direct INSERT; read-access events | Security | SEC-02, SEC-06, ARC-09; SEC-REM P1-3 | M | D1 confirmation spike (V2-03) for the trigger part; P1-05 for the in-tx part | V2-05 (triggers), V2-07 (in-tx) |
| P1-05 | Atomic server commands as plpgsql RPCs (C18) for invoice+items, payment, sign-off (+audit+outbox), amendment, check-in, walk-in, register+book, collect | Backend | ARC-09, ARC-10, F-03, F-04, D11; PR-5; BACKEND D1-D4 | L | P0-10, D1 confirmation spike (V2-03) | V2-07 |
| P1-06 | Billing invariants (**PO-4 ✅ accepted**): status guards, overpayment cap, cancel/void/refund, Indian-FY counter table (`INV/2026-27/00001`, shared `lib/fy` with SUB-05), money CHECKs, one active invoice per visit; no patient payment gateway | Backend / Billing | D14, DB-11, D11/D12; BACKEND C5, C6, C8 | M | PO-4, P1-05 | V2-10 |
| P1-07 | Visit state machine (DB + service); check-in validation; role-gated consult entry; `/consultation/[id]` permission gate | Backend / UX | D13, UX-3.2 | M | PO-3 | V2-08 |
| P1-08 | CASCADE → RESTRICT on clinical and financial children; drop `visits_delete_member` | DB | DB-03; BACKEND C4 | S | — | V2-05 |
| ~~P1-09~~ | ~~Staff lifecycle~~ **Replaced by AUTH-05** (membership status, removal, session revocation, API-key revocation); key scopes and expiry stay in P1-37 | Security | SEC-07, API-11 | — | — | see AUTH-05 |
| P1-10 | Referrals: receiver may update status columns only; target constrained (directory/opt-in); consent check | Security | ARC-07 (C15) | S-M | P1-01 | V2-05 |
| P1-11 | Exports require `exports:create`; minimal DTOs | Security / API | API-15 | S | PO-3 | V2-05 |
| P1-12 | Multi-clinic: clinic switcher setting the active-tenant cookie; guard second-membership creation | Product | F9 | S-M | — | V2-08 |
| P1-13 | Messaging governance at enqueue and send: opt-out, DPDP consent, quiet hours (tenant TZ), quota; no phone numbers in audit metadata or notifications | Backend / Privacy | F6, ARC-15; BACKEND F4 | M | P0-12 | V2-12 |
| P1-14 | **Appointment** reminder producers only (PO-8 ✅): day-before + 2 h before by default, configurable per clinic, booked appointments only. Vaccine reminders → v2.1 (AI-25) | Product / Backend | F5 | M | P0-12, P1-13, MSG91 template approval | V2-12 |
| P1-15 | Fail-closed configuration: complete env schema; production forbids the dev messaging provider and mock AI; `/api/ready` checks providers (the dev-OTP clause is dropped: AUTH-01 deletes the shortcut) | Platform / Security | D15, SEC-14, SEC-15; I-07; BACKEND B5 | S-M | — | V2-03 |
| ~~P1-16~~ | ~~AI data protection~~ **Superseded by AI-04 + AI-05** (gateway with pseudonymisation and structured output; scribe v2) and AI-03 (gating) | Security / AI | SEC-16 | — | — | see AI-03/04/05 |
| P1-17 | DPDP lifecycle: retention policy + purge/anonymise jobs (dry-run, PO approval after an isolated reviewer's check), restrict-vs-erase workflow + staff UI, storage deletion, erased rows hidden by RLS; machinery reused by SUB-07 | Privacy | SEC-30, DB-21/22; BACKEND F6-F7 | L | PO approval of the retention schedule (PO-12: no counsel), P0-12, P1-01 | V2-13 |
| P1-18 | Security headers + nonce CSP **including `worker-src 'self'` and `manifest-src 'self'`** (for PWA-02); `no-referrer` and `no-store` on PHI and token pages | Security | SEC-13 | S-M | — | V2-14 |
| P1-19 | zod 4 + AI SDK major upgrade (clears the remaining 9 audit findings) + `@supabase/ssr` upgrade from 0.5.2 + Dependabot | Platform | SEC-24, F-6, ARC-22 (C9, C10) | M-L | P0-11 | V2-12 |
| P1-20 | Self-reschedule fixes (IST slots, slot/conflict validation) + staff reschedule/cancel/no-show commands | Backend | F7, F-06 | M | P1-05, P1-21 | V2-08 |
| P1-21 | `lib/datetime` (tenant TZ) and replacement of the 29 UTC "today" sites; lint ban | Platform | UX-12; ADR-016 | S | — | V2-03 |
| ~~P1-22~~ | ~~Fix the copilot no-op confirm~~ **Replaced by AI-01** (the operations copilot is removed in v2.0; rebuilt in v2.1 as AI-21) | AI / UX | F8 | — | — | see AI-01 |
| P1-23 | Sign-off error handling and `visit.completed` payload (`patient_id`; real `doctor_id`); drop the `queue_tokens.updated_at` write | Backend | ARC-10, D10; BACKEND A7 | S | — | V2-01 |
| P1-24 | Labs: **relabel as documents (PO-5 ✅)**; fix the in-consult upload dropzone; camera capture via PWA-12. Structured labs → P2-13 (v2.1) | Product | F10, F-08 | S | — | V2-09b (dropzone), V2-11 (relabel) |
| P1-25 | Observability: error tracking (scrubbed; India-resident `ops.error_events` sink, no vendor outside India, §6), structured logger, request IDs (V2-03); dead-letter and queue-lag alerts (V2-04); log drain ≥ 180 days in India (V2-15, front-end drain if available; database logs after the Supabase Pro upgrade; FT-07 covers the UAT stage) | Infra | F-5; I-08, I-09; BACKEND H1-H4 | M | PO-6 ✅ | V2-03, V2-04, V2-15 |
| P1-26 | Distributed (Postgres) rate limiting for `/api/v1`, public token routes, AI and the Send Email hook; confirm Supabase Auth limits (the `requestOtpAction` throttle is obsolete: AUTH-04) | Security | F-8; *(SEC-11 unverified)* | S-M | — | V2-12 |
| P1-27 | Test quality: Playwright scaffold + v1 characterisation e2e (6 flows) + axe; type-check tests; remove tautological and mock-isolation tests; teardown (P0 if the hosted project is prod) | QA | E-2, E-5, E-8, FTA-perf; T-02, T-10-T-12 | L | P0-10 | V2-02 |
| P1-28 | Design system + frontend foundation: tokens, fonts, shadcn/Radix primitives, clinical components, shell, IA, command palette, route loading/error states, toasts | Frontend | F-09, F-10, F-11, UX-3.11, F-12; M1-M3 | L | G2, P1-27 (M0) | V2-06 |
| P1-29 | **Today** workspace (front desk / nurse / doctor) with Realtime + polling fallback, walk-in, check-in, vitals | Frontend | F-02, F-03; M4.1 | L | P1-28, P1-05, P1-07, PO-3 | V2-08 |
| P1-30 | PatientPicker + QuickRegister with server-side dedup everywhere; search GET endpoint | Frontend / Backend | F-05; M4.2; PR-6 | M | P1-28 | V2-08 |
| P1-31 | Booking, reschedule, cancel, no-show; schedule views; patient-context hand-offs | Frontend | F-04, F-06, F-07; M4.3 | L | P1-20, P1-30 | V2-08 |
| P1-32 | Consultation workspace + Rx rebuild (draft versioning, unload guard, keyboard Rx) | Frontend / Clinical | F-08; M4.4 | XL | P1-03, P1-28 | V2-09b, V2-09c |
| P1-33 | Collect payment + collections (en-IN money) | Frontend / Billing | F-03, UX-3.5; M4.5 | M | P1-06 | V2-10 |
| P1-34 | Platform hygiene: single service-role factory (all 5), generated DB types, migration immutability + drift baseline (B1), boundary lint rules (ESLint `no-restricted-imports`, the only enforcement mechanism), ESLint ignores for tooling dirs | Backend | C3, ARC-01; BACKEND B1-B6, B8 | M | P0-11 | V2-03 |
| P1-35a | Staging environment: staging Supabase project (Mumbai, synthetic data) + Vercel staging; needed by V2-04 and V2-14 | Infra | F-4; I-02 | S-M | PO-6, PO-17 | V2-03 |
| P1-35b | Production environment per the C26 decision tree; approval-gated migration jobs (used by UAT and, unchanged, by the paid launch) | Infra | F-4; I-02, I-06 | M | PO-1, PO-6, PO-7, P1-35a | V2-15 |
| P1-36 | GSD for Claude Code (pinned, project-local), archive v1 truthfully, `CLAUDE.md`, `docs/adr/`; **retire `.agents/` and `.opencode/`** and the OpenCode reviewer config (PO-11 ✅) | Workflow | G-1; GSD W-03-W-07 | S | P0-09 | V2-00 |
| P1-37 | API v1 hardening: `withApi`, `api_authenticate()` principal (amended ADR-011), idempotency keys, DTO allow-lists, generated OpenAPI. **Drops to P2 if PO-16 finds no API consumers** (and `/api/v1` stays disabled). | API | API-11; BACKEND G1-G6 | M | P1-01, AUTH-05 (replaces P1-09), PO-16 | V2-12 |
| P1-38 | Incident response + breach runbook (CERT-In 6 h, DPDP templates drafted by Claude, PO-12); `security.txt` | Ops | F-5; I-14 | S | — | V2-15 |
| P1-39 | No double-booking: `btree_gist` exclusion constraint on doctor + time range (respecting `is_overbooked` and cancelled/no-show); overlap diagnostic first | DB | DB-08 | M | Diagnostics run, P0-16a | V2-05 |
| P1-40 | Queue tokens: per-tenant-per-day counter table (`INSERT … ON CONFLICT DO UPDATE … RETURNING`), date computed in the tenant TZ in SQL; replaces `generate_daily_queue_token` | DB | DB-09, D11 | S | P1-21 | V2-05 |
| P1-41 | Quality gates for §15 and §17: coverage reporting in CI (report-only from V2-02, enforced at the G2 thresholds by V2-14); k6 at go-live load + Lighthouse mobile on Today and consult (V2-15). Split from P2-08. | QA | T-15, T-17 | M | P0-11, PO-13 | V2-02, V2-14, V2-15 |
| P1-42 | Remaining e2e journeys 2, 3, 5, 7 and 10 at both viewports, each delivered with its workflow phase. TEST_STRATEGY T-14 raised from P2 (C32). | QA | T-14 | L | P1-27 | V2-08 to V2-11 |
| P1-43 | Remove the R2/S3 storage provider; Supabase Storage only (C23) | Backend | ARC-19 | S | — | V2-03 |
| P2-01 | Next 16 upgrade (separate PR, before M2) | Platform | FTA-D2 (C24) | M | P0-11 | V2-03 |
| P2-02 | Bundle budgets in CI (the lazy AI drawer part is dropped: AI-01 removes the drawer; budgets merge with PWA-09) | Frontend | FTA-perf | S | P1-28 | V2-06 |
| P2-03 | Remove `VITEST`/`NODE_ENV` branches from production code; live AI eval lane | QA | E-6; T-13, T-16 | S-M | P0-11 | V2-03 |
| P2-04 | Hygiene: test password, fix v1 verification records (E-12); **securely delete** (not move) `.planning/dev-messages.txt` and `dev-auth-logs.txt`, which contain phone numbers (AI §2.2 owner action), and record the deletion | QA / Workflow | E-3, E-12 | S | P1-36 | V2-00 |
| P2-05 | Patient profile and history; paginated registers with URL filters; settings regroup | Frontend | M4.6-M4.7; UX-10, UX-13, UX-14 | M | P1-28 | V2-11 |
| P2-06 | SSRF redirect/DNS hardening; filter-input validation; generic errors; share-link hygiene; upload hardening *(unverified: SEC-10, SEC-20 to SEC-23)* | Security | SEC-REM P2 | M | P0-13 | V2-14 |
| ~~P2-07~~ | ~~MFA and session policy~~ **Moved to AUTH-08/AUTH-09 and raised to P1** (owner TOTP in V2-11; platform-admin TOTP in V2-13c) | Security | SEC-REM P1-5 | — | — | see AUTH-08/09 |
| P2-08 | Performance indexes (trigram search, FK indexes). The k6, Lighthouse and coverage parts moved to P1-41. | DB | DATABASE §4 | S-M | P0-11 | V2-05 (FK), V2-08 (trigram) |
| P2-09 | Webhook signing secrets: stop returning them on every list; show once at creation, then masked; rotate action | API / Security | WH-04 (`features/webhooks/actions.ts:35,48,107`) | S | — | V2-12 |
| P2-10 | Print stylesheet and clinic letterhead for Rx and receipt | Frontend | UX-15 | S | P1-28 | V2-09c, V2-10 |
| P2-11 | Tamper-evident audit: no UPDATE/DELETE even for `service_role` (trigger), optional `prev_hash` chain | DB / Security | DB-23 | S | P1-04 | V2-13 |
| ~~P2-12~~ | ~~Drug–allergy inline check~~ **Merged into AI-11** (SA-07 allergy check: substance-level only; class-level deferred to v2.1 per PO-22) | Clinical / Frontend | UX-16 | — | — | see AI-11 |
| P2-DOC | Errata: SECURITY §3 (C1), API §4 (C2), DATABASE §7 (C29), counts (C3-C8), SEC-01 "six actions" (C31), TEST_STRATEGY T-14 (C32), ARCHITECTURE_DECISIONS ADR-003/006/011 (C18, C19), SECURITY_VERIFICATION Semgrep rule (C20); fill SEC-08…33 template fields; TARGET §10 rows for frontend, testing and security tooling. **New-track errata (bodies, not only banners; sources PWA §12, AI §11.2, AUTH §10, SUB §13.2):** TEST_STRATEGY:247/249/269 (Pixel 5 lane → PWA §9.1 matrix; journey 1 OTP → password login); DATA_HANDLING processor rows (Vertex `asia-south1`, SES, Razorpay, Turnstile/HIBP, India error sink) and the §5 AI-metadata row; TARGET_ARCHITECTURE:151/305 (`lib/integrations/ai`, drop `ai.summary`, add `ai.reservations_cleanup`); DESIGN_SYSTEM:527/549 (no local drafts); UX_AUDIT:730 (server autosave); FRONTEND_TECHNOLOGY_ASSESSMENT:172 (`idb-keyval` rejected); FRONTEND_MIGRATION_PLAN:71/169/222; SECURITY_REMEDIATION P1-7 (`worker-src`/`manifest-src`, `/sw.js` headers) and P1-9 (→ AI-04/AI-05); THREAT_MODEL SR-8 (→ AI-04/AI-05) | Docs | VERIFICATION_LOG §4 | S-M | — | V2-00 |
| P2-13 | Structured lab orders and results (PO-5 ✅: v2.1) | Product | F10 | L | v2.0 shipped | v2.1 |
| P3-01 | Persisted offline Today (with PWA-13 after a DPDP review); i18n scaffolding | Frontend | UX-17, UX-18 | M | — | after v2.0 |
| P3-02 | DSC/eSign on e-prescriptions ⚖; ABHA column encryption; ASVS L2 self-assessment → ISO 27001 readiness | Security | SEC-REM P3 | L | — | after v2.0 |
| P3-03 | Mutation testing, visual regression, Supabase Branching, status page | QA / Infra | T-19, T-20, I-17 | M | — | after v2.0 |

### 10.2 New tracks from the PO decisions of 2026-11-10

Full descriptions, acceptance criteria and evidence live in the source documents. The phase placement below is final and overrides any placement in those documents (C36, C37).

**SUB: SaaS subscriptions, entitlements, platform admin and tenant data lifecycle** ([SUBSCRIPTIONS_AND_PLANS §13](SUBSCRIPTIONS_AND_PLANS.md))

| ID | Item | Pri | Size | Depends on | Phase |
|---|---|---|---|---|---|
| SUB-10 | Merchant readiness: public Terms (incl. retention and purge), Privacy, Refund & Cancellation, Pricing ("₹1,499 + GST"), Contact; start Razorpay KYC (**live mode needed at UAT start** for real mandates with `uat` codes, SUB-D9; comp fallback otherwise), get a Cashfree quote; **GST registration (GSTIN) before paid launch (G7)**: UAT on `uat` codes debits nothing, so it needs no GSTIN (PO-20, SUB §14.8) | P1 (long lead) | S | PO-20 ✅, PO-19 ✅ | V2-00/V2-01 (PO-side, right after G1) |
| SUB-01 | Product catalogue (`plans` with `kind`, `purchasable` and `visibility`), prices with a `billing_model` (flat, per unit, metered, included units + overage) and GST-exclusive fields (`base_amount_paise`, `tax_rate_bp`, `tax_inclusive = false`, derived charge amount; C44), entitlement keys, `tenant_subscriptions`, `platform_settings`, events (`tenant_addons` is deferred with SUB-11); `billing_internal` access and entitlement functions with caller-bound wrappers; transition RPCs; `platform.*` actor rule; seeds; drop v1 `subscriptions`/`payment_records`; `comp_until` for dev and staging tenants | P1 | M | V2-01a, V2-03 (03-03) | V2-05 |
| SUB-02 | Enforcement of the hard stop: RLS and **storage policies** on the access helper, signed-URL TTL caps, `assertTenantAccess`, `requireEntitlement`, layout redirects, functional `/billing/locked` pages, `/api/v1` 402, jobs skip locked tenants | P1 | M | SUB-01, P1-01 | V2-05 |
| SUB-03 | Razorpay integration: `BillingProvider` (Razorpay + Fake), in-page checkout with PWA resume, signature verification, webhook route, cancel/resume/change method/re-purchase | P1 | L | SUB-01, V2-04, P1-15, AUTH-04, SUB-10, PO-20 | V2-13b |
| SUB-04 | Lifecycle jobs: `lifecycle_tick`, daily reconcile + divergence alert, upcoming-debit and dunning notices (email; WhatsApp opt-in), incomplete clean-up | P1 | M | SUB-03, V2-04, AUTH-03, P1-13, P1-25 | V2-13b |
| SUB-05 | SaaS GST tax invoices for the GST-exclusive price (₹1,499.00 taxable + CGST ₹134.91 + SGST ₹134.91, or IGST ₹269.82 = ₹1,768.82): FY numbering (shared `lib/fy`), PDF, email, credit-note rows | P1 | M | SUB-03, PO-20 ✅ + GSTIN, P1-06 | V2-13b |
| SUB-08 | Owner billing UI: `/settings/billing`, `/onboarding/billing`, trial/past-due/cancelling banners, locked pages styled; prices shown as "₹1,499 + GST" with the ₹1,768.82 debit stated at checkout; AI shown as "Coming soon" with no price or buy button (PO-21) | P1 | M | SUB-03, V2-06 | V2-13b |
| ~~SUB-11~~ | ~~AI Assist add-on billing as a second subscription (C33)~~ **Deferred until the AI Voice Receptionist launch (PO-21, C41).** The purchase flow, `tenant_addons` and add-on webhooks are designed then, for the billing model those products need (the second-subscription design in SUB §7.4 is the reference for flat-fee add-ons) | — | — | — | post-v2.0 |
| SUB-06 | Tenant data export (streamed ZIP, private India bucket, re-auth, 15-min in-app signed URL, audit; Vercel limits spike) | P1 | M | V2-04, V2-13 | V2-13c |
| SUB-07 | Archive and purge (logical archive, purge with dry-run + admin approval, statutory survivors, deletion certificate) | P1 (required before UAT start) | M | SUB-04, SUB-06, P1-17 | V2-13c |
| SUB-09 | Platform admin portal `/platform`: tenant list/detail, trial extend, comp, overrides, reconcile now, lifecycle queue with purge approval; **minimal "Plans & prices" screen** (list plans and price versions; add a new price version through `platform.create_plan_price`; edit trial length, grace, buffer and quotas through `platform_settings`/`plan_entitlements` RPCs) so the PO configures pricing from the UI as asked (SQL stays the fallback); the screen also lists products with their billing model and the **availability switch** (`purchasable`, `visibility`), so AI products can be made purchasable later without a deploy once their purchase flow exists; platform-admin TOTP (with AUTH-08) | P1 | M (+S) | SUB-01…04, SUB-07, AUTH-04 | V2-13c |
| **SUB-COUPON-01** | Coupons data layer (round 3, SUB §14.3): schema, RPCs, RLS and pgTAP for `coupons`, `coupon_codes`, provider offers (**one per coupon, price and supply type `intra`/`inter`**; both required before a coupon is enabled; 50 % → 88442 / 88441 paise), redemptions, `saas_refunds`, invoice discount columns and a credit-note series | P1 | M | SUB-01 | V2-13b |
| **SUB-COUPON-02** | Checkout redemption: rate-limited validation (uniform errors); reserve → apply → release; deferred Razorpay `start_at` for free cycles, trial extension and `uat` codes (the mandate is still authorised with the ₹5 auto-refunded token); coupon-funded lifecycle transition; UAT feature grants; carry-over rules; re-confirm task when an admin applies a code | P1 | M | SUB-COUPON-01, SUB-03, SUB-04 | V2-13b |
| **SUB-COUPON-03** | Razorpay **flat offers** for percentage and fixed discounts (computed by us on the GST-exclusive base, one offer per supply type picked at checkout from the billing-profile state; offers cannot leave a charge of ₹1 or less): test-mode spike first, then amount reconciliation and an enable switch | P2 | M | SUB-COUPON-01, SUB-03 | V2-13b (may slip until after paid launch; not needed for UAT) |
| **SUB-COUPON-04** | Invoice discount line, GST on the discounted taxable value, credit-note series and PDF | P1 | S | SUB-05, SUB-COUPON-01 | V2-13b |
| **SUB-COUPON-05** | SaaS refunds: idempotent `platform.refund_payment` RPC, `refund.*` webhooks, reconciliation import of Dashboard refunds, credit note, audit (refunds are the UAT exception path) | P1 | M | SUB-03, SUB-COUPON-04 | V2-13b |
| **SUB-COUPON-06** | Admin **Coupons** screen (campaigns, code batches, redemptions) and **Refund** action in `/platform` | P1 | M | SUB-09, SUB-COUPON-01…05 | V2-13c |
| **SUB-COUPON-07** | Owner UI: code entry at checkout and re-purchase, discount and free-period display, forfeiture notice | P1 | S | SUB-08, SUB-COUPON-02 | V2-13b |
| **SUB-COUPON-08** | UAT operations: `uat` campaign and assigned single-use codes, invite text, comp-access fallback runbook (if live mode or a long `start_at` is not available), **UAT exit checklist** wired into G7 | P1 | S | SUB-COUPON-02, -05, -06 | V2-15 (campaign, codes, runbook), V2-16 (exit checklist) |

Track total about **L** (SUB §14.11). Unconfirmed provider facts (whether an offer changes the ₹5 authorisation, the longest future `start_at` Razorpay accepts, whether an expired offer stops applying to linked subscriptions) are on the SUB §14.9 test-mode checklist and are confirmed in V2-13b; the effective date of the 2026 GST amendment on post-sale discounts is **Unconfirmed** (checked with the GST registration). SUB-D9/D10 are adopted defaults (PO may override) and SUB-D11 is a PO operational input (the UAT exit date) (SUB §14.12); none is an open product decision.

**AI: gating, Smart Assist and the India-region scribe** ([AI_STRATEGY §11](AI_STRATEGY.md))

| ID | Item | Pri | Size | Depends on | Phase |
|---|---|---|---|---|---|
| AI-01 | Containment: remove both copilots, the drawer, the mic and `MockAiProvider`; scribe fails closed; relabel deterministic UI. Replaces P1-22 | P0/P1 | S | — | V2-01 |
| AI-02 | Labelling: "AI Assist" and "Smart Assist" tokens and glyphs; copy rules; CI grep for "AI" in base-plan copy; the **"Preview"** chip and note for AI during the trial and the **"Coming soon"** treatment on plan and billing pages (PO-21) | P1 | S | V2-06 tokens | V2-06 |
| AI-03 | Entitlement checks, trial rule (1,500-draft trial quota, PO-21; post-trial per PO-25), owner opt-in, patient objection flag, kill switch, quota with expiring reservations, grants | P1 | M | SUB-01, SUB-02 | V2-05 (DB) + V2-12 (app) |
| AI-04 | AI gateway `lib/integrations/ai`, Vertex `asia-south1` adapter, pseudonymise, post-checks, `ai_calls`, rate limits. Supersedes P1-16 | P1 | M | P1-19, P1-26, P1-15, AI-03 | V2-12 |
| AI-05 | AI Scribe v2: server context, `{text, source_span}`, per-section accept, provenance, 6 failure states | P1 | M | AI-04, V2-09b save model | **V2-12** (plan 12-06, C37) |
| AI-06 | Eval harness L1–L3, ≥ 60 synthetic golden cases | P1 | M | L1: V2-02; L2: AI-03 (DB) and AI-04; L3: AI-04, PO-22 | V2-02 (L1: copy and route greps), V2-05 (L2 gating contract matrix, database part), V2-12 (L2 gateway part, L3) |
| AI-07, AI-09, AI-10, AI-15 | Smart Assist: terminology search, shorthand expander, patient snapshot, follow-up → proposed appointment | P1 (AI-15 P2) | M + M + S + S | V2-05; AI-13 for AI-15 | V2-09b |
| AI-08, AI-11 | Smart Assist: Rx favourites fix; allergy check substance-level only (class-level deferred to v2.1 per PO-22). AI-11 replaces P2-12 | P1 / P2 | S + M | CDCI mapping, V2-08 | V2-09c |
| AI-13, AI-14 | Smart Assist: slot suggestions; duplicate-patient detection (receptionist registration, PO-3) | P1 | M + S-M | V2-07; V2-05 | V2-08 |
| AI-16 | Help search, vitals flags (if time permits) | P3 | S | V2-06 | V2-06 / V2-09b |
| AI-17 | Provider setup and terms: GCP project, caching and logging off, ZDR request, budget alert, Google DPA, AI terms, patient notice, licence checks | P1 | S | PO account actions | V2-12 |
| AI-18 | AI feature keys; catalogue rows for future AI products (`ai_assist` scribe add-on, `ai_voice_receptionist`) seeded with `purchasable = false`, `visibility = 'coming_soon'` and no provider plan; the `standard_trial` limit `ai.scribe.monthly_drafts = 1500`; the `platform.set_product_availability` RPC (the backend switch) | P1 | S | SUB-01, PO-21 ✅, PO-25 | **V2-05** (plan 05-09; moved from V2-13b, C41) |
| AI-12, AI-21…AI-26 | v2.1: dose calculator (after a regulatory check), ops copilot, patient advice, voice scribe, vaccine engine, Bedrock India adapter; AI-23 clinical Q&A unscheduled | P2/P3 | — | — | v2.1 |

**AUTH: password login, OTP only for signup and recovery** ([AUTH_REDESIGN §11](AUTH_REDESIGN.md))

| ID | Item | Pri | Size | Depends on | Phase |
|---|---|---|---|---|---|
| AUTH-00 | Supabase Auth spike (verifyOtp types, CAPTCHA coverage, `/otp` behaviour, pre-account hijack fix, session deletion) | P1 | S | V2-01a | V2-01a (local); re-check in V2-03 |
| AUTH-01 | Delete v1 OTP login and join paths, dev OTP shortcut, dev auth logger; CI grep gates | P0 | S | AUTH-00 | V2-01 |
| AUTH-02 | Auth config as code, Mailpit, config-drift check | P1 | S | V2-01a, V2-02 | V2-03 |
| AUTH-03 | Amazon SES `ap-south-1`, DKIM/SPF/DMARC, sandbox exit, Send Email hook (SMTP fallback), bounce webhook | P1 | M | AUTH-00, PO-19 | V2-03 (staging), V2-15 (production) |
| AUTH-04 | (a) minimal password sign-in + forgot password; (b) change password, error mapping, safe `next`, `POST /auth/signout` (server-side sign-out + `Clear-Site-Data: "cache"`; PWA-02 later wraps it in `hardSignOut()`), Turnstile (Managed mode) on sign-in and reset (Supabase's CAPTCHA switch enforces these endpoints anyway; accepted default, C43), the FT-05 leaked-password check | P1 | M | (a) AUTH-01; (b) AUTH-02, AUTH-00 staging re-check | (a) V2-01, (b) V2-03 |
| AUTH-05 | Membership status, removal, session and API-key revocation. Replaces P1-09 | P1 | M | P1-01, P0-02 | V2-05 (backend), V2-11 (UI) |
| AUTH-06 | Invitations v2 (email-bound, 72 h, revoke/resend, link + set password, in-app-browser-safe `/join`). Replaces P0-15 | P0 | M | AUTH-03, AUTH-05, V2-04 | V2-05 (backend), V2-11 (UI) |
| AUTH-07 | Owner signup (email + password + OTP verify + pre-hijack guard), owner DPDP notice, onboarding state machine, post-login routing by tenant state | P1 | M | AUTH-04, SUB-01/02/03/08 | **V2-13b** (C36) |
| AUTH-08 | TOTP MFA and `requireRecentAuth`; owner email change and transfer; platform-admin aal2 with two factors and break-glass. Absorbs P2-07 | P1 | M | Clinic side: AUTH-04; platform side: SUB-01, SUB-09 | V2-11 (clinic side), **V2-13c** (platform side) |
| AUTH-09 | Session policy (900 s JWT, 7-day inactivity, 14-day time-box; app-side on Supabase Free, FT-06), sign out everywhere, auth audit (kept ≥ 180 days, FT-07); idle local sign-out via `hardSignOut()` on clinical screens (P2) | P1 | S | AUTH-04, P1-04, PWA-02 | V2-11 |

**PWA: installable web app on phones and tablets** ([PWA_STRATEGY §14](PWA_STRATEGY.md))

| ID | Item | Pri | Size | Depends on | Phase |
|---|---|---|---|---|---|
| PWA-01 | Manifest, icons, `viewport`/`themeColor`, `appleWebApp`, `lang="en-IN"`; public PWA assets bypass auth and entitlement checks | P1 | S | PO-19, V2-DX | V2-06 |
| PWA-02 | Hand-written service worker (allowlist), `/offline`, `/sw.js` headers only, `hardSignOut()` wrapping AUTH-04b's `POST /auth/signout` + grep guard, `no-store` on authenticated responses. The CSP `worker-src 'self'`/`manifest-src 'self'` directives ship with P1-18 in V2-14 | P1 | M | AUTH-04 | V2-06 |
| PWA-03 | Standalone shell (safe areas, `dvh`, in-app Back, keyboard-aware bars, refetch on resume); tablet two-pane Today and Consult | P1 | M (+S in V2-DX) | V2-DX | V2-DX, V2-06, V2-08, V2-09b |
| PWA-04 | Install UX: Android prompt, iOS sheet, in-app-browser detection | P1 | S | PWA-01, PWA-02 | V2-06 |
| PWA-05 | Update, skew and lock handling: `/api/session-status`, update toast, `SUBSCRIPTION_LOCKED` handling, Realtime unsubscribe, Skew Protection | P1 | S | PWA-02; SUB-02 | V2-06; lock path end to end in **V2-13b** |
| PWA-06 | (a) `client_request_id` idempotency on write RPCs; (b) client timeout, retry-once, SaveStatus per workflow | P1 | M + S per workflow | V2-07 | V2-07; V2-08, V2-09b, V2-10 |
| PWA-07 | Input modes, autocomplete and 16 px inputs in primitives + guard test | P1 | S | M2 | V2-06 |
| PWA-08 | Playwright device matrix (phones, 744/800 tablets) + PWA specs 1–11 (cache audit, lock while open) | P1 | M | V2-01a, V2-02; V2-07 (spec 7); SUB-02 (spec 9) | V2-02, V2-06, V2-13b |
| PWA-09 | Lighthouse CI on 4 routes: report-only, then blocking at V2-15 | P1 | S | PWA-08 | V2-06 → V2-15 |
| PWA-10 | Real-device checklist R1–R15 (PO run; scored by a reviewer agent), early after V2-08 and final at V2-15 | P1 | S | PO-17 (device) | V2-08, V2-15 |
| PWA-12 | Camera capture for lab documents, Web Share of PDFs, manifest shortcuts | P2 | S | PWA-01 | V2-09c, V2-10 |
| PWA-13 | v2.1: PHI-free staff web push; persisted offline Today after DPDP review | P3 | M | V2-04 | v2.1 |

**FT: free-tier operating mode for the UAT stage** (PO-17 round 2, scoped by round 3; §9.1)

| ID | Item | Pri | Size | Depends on | Phase |
|---|---|---|---|---|---|
| FT-01 | Project layout on free tiers: staging and production Supabase Free projects in **separate organisations** (2-active-project cap; production upgradable alone); v1 test project paused or deleted before staging is created; Vercel environments set up by the PO (PO-24 closed) | P0 | S | PO-17 ✅ | V2-03 (staging), V2-15 (production) |
| FT-02 | Self-run backups: `supabase db dump` (schema, data, roles) plus Storage object sync, twice a day, from a scheduled task in AWS `ap-south-1` (never a GitHub-hosted runner, PO-23(h)); encrypted with age before upload; versioned S3 bucket in `ap-south-1` with 30-day retention; failure alert; an on-demand dump before every production migration and purge batch; monthly restore drill into a local stack, logged in VERIFICATION_LOG; RPO ≤ 12 h, RTO ≤ 4 h (validate) | P0 (UAT-start blocker, G6) | M | V2-03 (staging), P1-25 alerts, AWS account (shared with SES) | V2-04 (built and drilled on staging), V2-15 (production) |
| FT-03 | Inactivity-pause mitigation: pg_cron heartbeat every 6 h; pause-warning emails to a monitored inbox | P1 | S | V2-04 scheduler | V2-04 |
| FT-04 | Quota monitor: weekly job recording database size, Storage bytes and MAU, alerting at 60 % (upgrade trigger) and 70 %; the PO's monthly egress check; client-side image compression for uploads | P1 | S | V2-04, P1-25 | V2-04 (job), V2-09c (compression) |
| FT-05 | App-side leaked-password check against the Pwned Passwords range API (k-anonymity) in every set-password server action; if the API is unreachable it allows the password and logs a warning (**Assumption (validate)**: availability over strictness at signup) | P1 | S | AUTH-04 | V2-03 (with AUTH-04b); reused by AUTH-06/07 |
| FT-06 | App-side session policy (14-day time-box, 7-day inactivity) while Supabase Free lacks the settings; session timestamps read through a SECURITY DEFINER function (columns confirmed in AUTH-00) | P1 | S | AUTH-00, AUTH-09 | V2-11 (with AUTH-09) |
| FT-07 | In-app retention (≥ 180 days, in India, within a size budget) of auth, platform-admin, billing-webhook and error events, because platform logs last 1 hour to 1 day | P1 | S | P1-25, AUTH-09 | V2-03 (sink), V2-11 (auth events) |
| FT-08 | Upgrade runbook and early-trigger watch (§9.1); **execution of the Supabase Pro + PITR upgrade at UAT exit** (default; PO-26) with a PITR restore drill | P0 (paid launch) | S | FT-02, FT-04, PO-26 | V2-15 (runbook, trigger watch), V2-16 (upgrade) |

### 10.3 Prioritisation rulings on contradictions

| # | Ruling |
|---|---|
| C9/C10 | The dependency fix is split. The non-breaking next/postcss patch is **P0-06 (S)**. zod 4 + AI SDK major is **P1-19 (M-L)** with its own regression gate. |
| C11 | Share-token binding is **P0**, covering all six routes and the policy |
| C12 | The override removal is **M**; the membership guard is **S-M**. No day estimates anywhere. |
| C13 | Role-aware RLS is **P1** (P1-01), scheduled first in V2-05. P0-02 and P0-13 cover the escalation part now. **Closed (round 3):** with the big-bang model (PO-15), no live clinic data exists before V2-05 lands, so the interim insider exposure has no real-data impact; V2-05 stays a blocker for UAT start (G6) and paid launch (G7). |
| C14/C15 | Audit forgery, notification visibility and referral rewrite are **P1** |
| C16/C17 | CI, the local test DB and the atomic claim + scheduler are **P0**. The SEC P0 exit criterion becomes "verified on a local stack, or by the scripted hotfix test plan" (removes the circular dependency). **Revised after review:** the local DB harness (P0-10, V2-01a) lands **before** the override removal, so V2-01 has an executable regression net. |
| C18 | Atomic commands are plpgsql RPCs per flow; Kysely is superseded. The D1 confirmation spike moves to V2-03. |
| C31 | SEC-01 stays **Critical / P0** with 4 confirmed browser-reachable actions. |
| C32 | T-14 (remaining e2e journeys) is **P1** (P1-42). |
| C33 | **AI pricing mechanism** (AI_STRATEGY D-1 `ai_pro` plan vs SUB-D8 second subscription). **Ruling: SUB-D8 (a).** AI Assist is a separate add-on sold as a second Razorpay subscription (plan code `ai_assist`). Razorpay UPI/eMandate subscriptions cannot be updated (SUB §3.1 [S25]), so a combined `ai_pro` plan would force a full re-mandate of the base plan on every upgrade or downgrade. Price and quota come from AI D-1 (about ₹499, about 1,500 pooled drafts, set by SQL). PO-21. **Superseded by C41 (round 2):** no AI add-on is sold in v2.0; this second-subscription design is kept as the reference for future flat-fee add-ons. |
| C34 | **AI quota in the trial** (SUB R3: 100 drafts vs AI D-2: same as paid). **Ruling: AI D-2.** The PO said the trial has "no restrictions at all", so the trial quota equals the AI Assist monthly quota. It is still a `plan_entitlements` value, changeable by SQL. PO-21. **Superseded by C41:** the trial quota is a fixed, configurable 1,500 drafts (PO-21 round 2), no longer tied to an add-on. |
| C35 | **Feature-key names** (SUB `assist.smart.*`, `ai.copilot.*` vs AI §6.2 `assist.*`, `ai.operations_copilot`). **Ruling: AI_STRATEGY §6.2 owns the keys**, as both documents state. SUB seeds those names. |
| C36 | **Phase names for billing and admin** (AUTH and PWA use V2-10b and V2-11b; SUB uses V2-13b and V2-13c). **Ruling: V2-13b and V2-13c**, after V2-13 and before V2-14, because the billing phases need jobs, messaging and purge machinery (SUB §13.2). AUTH-07 and PWA-05's lock path go to V2-13b; AUTH-08's platform side goes to V2-13c. |
| C37 | **Scribe placement** (AI-05 in V2-09b, but its gateway AI-04 is in V2-12). **Ruling:** AI-05 is delivered in **V2-12**, after the gateway, on top of the V2-09b save model. V2-09b ships the consult without the scribe. |
| C38 | **Signup mandate open question** (`AUTH_REDESIGN.md:127`, "SUB"). **Ruling:** answered by SUB R4. The mandate is required to start the trial, and a tenant in `incomplete` sees only the "Start trial" step. |
| C39 | **Error-tracking vendor vs PO-12 "we only store in India"** (final review #1). **Ruling:** India-resident error sink (`ops.error_events` in the Mumbai project + the India log drain); no error-tracking vendor outside India. All remaining processing outside India is listed for PO acceptance in PO-23(h). |
| C41 | **AI sales in v2.0** (PO-21 round 2 vs SUB-11, AI-18 and the "Available with AI Assist" upsell in SUB §7.3, AI §6.3, INFORMATION_ARCHITECTURE §3.3 and DESIGN_SYSTEM §4.6). **Ruling:** no purchasable AI in v2.0. SUB-11 is deferred to the AI Voice Receptionist launch; AI-18 shrinks to catalogue rows with `purchasable = false` and moves to V2-05; upsells become a "Coming soon" row on plan and billing pages only; the trial scribe is labelled "Preview". Every AI safety control applies unchanged to preview use. |
| C42 | ~~**Free-tier hosting vs Vercel's terms**~~ **Superseded by C45 (round 3).** Supabase Free stays adopted with the §9.1 controls, for the UAT stage only (C46). |
| C43 | **CAPTCHA scope** (PO: "add for signups"; AUTH §4.1/§4.4 already put Turnstile on signup, sign-in and recovery). Supabase's single "Enable CAPTCHA protection" switch enforces the token on `/signup`, the `/token` password grant, `/otp`, `/magiclink`, `/recover`, `/resend` and `/sso` and cannot be limited to signup (Auth server source). **Ruling:** option A: Turnstile in **Managed** mode on every endpoint Supabase enforces; most users never see a challenge. A signup-only design (switch off, server-side `siteverify` in the signup action) would leave Supabase's public `signUp` endpoint unprotected and needs its own rate limiting, so it is not recommended; the PO can still ask for it (about S-M). **Round 3: recorded as the accepted default** (a superset of the PO's "add for signups"; the custom signup-only path is the rejected alternative). |
| C44 | **GST treatment** (SUB-D1 default "inclusive" vs PO-20 round 2 "excluding GST"). **Ruling:** exclusive: ₹1,499 + 18% GST = ₹1,768.82 debited; `plan_prices` gains `base_amount_paise`, `tax_rate_bp` and `tax_inclusive = false`; GST registration is a paid-launch blocker (G7; round 3). |
| C40 | **Plan/price editing UI** (SUB §9.3 had it as P2; the PO said SQL is the stopgap "and then when we move to admin portal we will configure from UI") (final review #2). **Ruling:** a minimal Plans & prices screen is part of SUB-09 in V2-13c. |
| C45 | **Production front-end hosting** (round 3: "I'll handle Vercel … don't worry about vercel"). **Ruling:** PO-24 closed, handled by the PO personally; R24 closed; no Vercel plan or terms item appears in blockers, risks, gates or the FT track. Only neutral technical notes remain (pg_cron scheduler, `bom1` desirable, Skew Protection and log drain if available). Supersedes C42. |
| C46 | **Free-tier scope and go-live shape** (round 2 "free tiers for 2–3 months after go-live" vs round 3 "only for user acceptance testing in real world … refunds or coupon codes"). **Ruling:** free tiers apply only to a **real-world UAT stage after all of v2 is built**, modelled as a new phase **V2-16** between gate **G6 (UAT start)** and gate **G7 (paid launch)**, rather than inside V2-15, because UAT has its own duration, exit criteria and upgrade step. The FT controls stay mandatory during UAT (real patient data possible). The Supabase Pro + PITR upgrade is a G7 exit criterion (default timing at UAT exit, before the first full-price charge; PO confirms, PO-26). The "90 days after go-live" and "first paying clinic beyond the pilot" triggers are removed. |
| C47 | **Coupons vs refunds for UAT; discount mechanics** (round 3 "refunds or coupon codes"; Razorpay offers cannot reach 100 % off). **Ruling (SUB §14):** UAT uses `uat` coupons (deferred `start_at`, real ₹5 mandate, automatic conversion at UAT exit); refunds are the audited exception path. Percentage and fixed discounts use Razorpay flat offers computed on the GST-exclusive base; GST is charged on the discounted taxable value; one coupon per subscription, no stacking. Coupons and refunds (SUB-COUPON-01/02/04/05/07) land in V2-13b, the admin screen in V2-13c, UAT operations in V2-15/V2-16; percentage/fixed offers (SUB-COUPON-03) may slip past paid launch. |
| C48 | **AI preview consent vs "silently"** (PO-21: "enable by default … but silently"; AI §4.6 owner opt-in). **Ruling (decided):** keep a one-time clinic-owner opt-in for the preview, because pseudonymised consult text goes to Google (DPDP consent) and the PO explicitly wants to avoid losing trust; the 1,500-draft quota stays silent (no meter, purchase flow, upsell or quota marketing). Replaces the round-2 "Deviation (PO to accept)" label. |

## 11. Recommended migration strategy

> Update (2026-11-10, PO decisions): PO-15 settles the deployment model. v2 is **not** rolled out incrementally; go-live happens only after all of v2 is finished, on a **new** production Supabase project (PO-1). There are no live clinics and no production data to migrate. The incremental-rollout path below has been removed.

> Update (2026-11-10, PO round 3; C46): after all of v2 is built, production first runs a **real-world UAT stage** (V2-16) with tester clinics on Supabase Free and `uat` coupon codes, then **launches paid** (G7) on the same project after the Supabase Pro + PITR upgrade. UAT is not an incremental rollout of v2 features: every feature is complete at G6.

**Principles:**
- **Contain first.**
- **Expand → migrate → contract** for every schema change on `feature/v2`, so each PR keeps the app working end to end on the local and staging stacks.
- **Strangler inside the monolith**: one domain at a time. Each rebuilt workflow **replaces** its v1 screen in the same phase; the v1 component is deleted when the new one merges. There is no soak period.
- **No rollout feature flags and no dual write paths** (`TX_<FLOW>`, per-tenant `ui_v2.<workflow>`): nothing live needs to coexist. Flags are kept only where they help development or operations:
  - `AI_ENABLED` (env) and `platform_settings.ai_features` (kill switch, AI-03);
  - the `/api/v1` env switch (PO-16);
  - the `FakeBillingProvider` selection in local and CI (SUB-03);
  - `comp_until` on a tenant, so dev, staging and the PO's own test clinics are never locked by the subscription hard stop (SUB-01);
  - the product availability switch (`plans.purchasable`, `plans.visibility`), which is data rather than a flag, so AI products can be made purchasable later without a deploy (PO-21, AI-18).
- **Tenants before self-service signup.** v1 signup is deleted in V2-01 (AUTH-01) and owner signup returns only in V2-13b (AUTH-07). Between V2-01 and V2-13b, tenants and owners exist **only through synthetic seeds** (local, CI, staging) with `comp_until` set (from V2-05, when SUB-02 makes access subscription-aware). No acceptance criterion before V2-13b may require a signup.
- The database migrates before the app deploys (on staging, then production at V2-15).
- No migration runs on any hosted project until P0-16a (backup/PITR verified, or a test-restored dump) is recorded. For the test project this is cheap (PO-1). The production project starts empty, and its FT-02 backup job must be live before the first real record (PITR only after the Pro upgrade, §9.1).
- Every step is reversible, or it is marked irreversible and needs a backup check plus PO approval (two-person approval becomes PO + isolated reviewer agent, PO-10).
- Characterisation tests come before rewrites, and an executable regression net comes before any auth refactor (V2-01a before V2-01).
- **Production is built, not migrated:** V2-15 creates the production project from the v2 migrations, seeds only reference data (plans, prices, entitlement keys, platform admin, the `uat` coupon campaign), and switches Razorpay to live mode.
- **UAT before paid launch (round 3):** UAT testers are admitted with assigned single-use `uat` codes (deferred first debit, real mandate), not by charge-and-refund; fixes found in UAT go through the normal phase flow (isolated review, CI) as forward fixes; no new scope enters during UAT (R12). The paid launch changes data (prices live, codes closed, Supabase plan), not code paths.

**Decision (C30): one sequence.** Security remediation is **deliberately pulled forward** into containment. Prompt Phase 0 work (V2-00) runs after G1. The order is G1 → V2-00 → G0 → G2. Phases run one at a time (PO-18).

```
Prompt Phase 1 ─ G1 ─► Discovery + PO decisions (PO-1…PO-26) + isolated review of this roadmap  [G1 APPROVED 2026-11-10]
                        └─► PO-side lead-time work starts: KYC + policy pages + GST registration (SUB-10), SES domain, GCP/Vertex, MSG91 templates
Prompt Phase 0 ─ G0 ─► V2-00 Pre-flight (agent safety, rotation, GSD for Claude Code, retire .agents/.opencode, archive v1)
                         │
                         └─► V2-01a Local DB harness (+AUTH-00) ► V2-01 Containment (+AUTH-01/04a, AI-01) ► V2-02 CI & e2e
Prompt Phase 2 ─ G2 ─► ADRs (incl. subscriptions, platform admin, AI gateway, auth, PWA data policy) ratified
               ─ G2-D ─► V2-DX Design exploration (runs alongside V2-01a…V2-02)
Prompt Phase 3 ─ G3 ─► V2-03 Platform hygiene (+auth config, SES staging, password-auth completion)
                        ► V2-04 Jobs reliability (+FT-02/03/04) ► V2-05 DB authorisation, integrity & entitlements (+SUB-01/02, AI-03/18, AUTH-05/06)
                        ► V2-06 Design system, FE foundation & PWA shell
Prompt Phase 4 ─ G4 (per PR) ─► V2-07 Atomic commands ► V2-08 Front desk ► V2-09a Clinical integrity (DB)
                        ► V2-09b Consult workspace ► V2-09c Rx builder & PDF ► V2-10 Billing & collections
                        ► V2-11 Profile/registers/staff/settings ► V2-12 Integrations, AI & API ► V2-13 DPDP lifecycle
                        ► V2-13b SaaS subscriptions & billing ► V2-13c Platform admin & tenant data lifecycle
Prompt Phase 5 ─ G5 ─► V2-14 Security verification & closure
Prompt Phase 6 ─► V2-15 Production readiness & UAT launch (big-bang build, PO-15) ─ G6 (UAT start) ─►
               V2-16 Real-world UAT on free tiers (uat coupons) ► Supabase Pro + PITR upgrade ─ G7 ─► paid launch
```

**Why this order for the new tracks:**
- **Auth early (V2-01, V2-03, V2-05):** every e2e test and every later flow logs in, so password login replaces email OTP in containment (AUTH-01/04a) and is completed with staging email in V2-03. Owner signup (AUTH-07) waits for V2-13b because it hands off to the mandate.
- **Entitlements before AI gating (V2-05 → V2-12):** SUB-01/02 put the access level and `has_entitlement()` into RLS in V2-05, so every later phase is built against the hard stop and AI-03/AI-04 have something to check.
- **PWA with the new shell (V2-06):** the manifest, service worker, `hardSignOut()` and safe-area shell are part of the frontend foundation; tablet layouts and retries ride with each workflow phase.
- **Subscriptions late but before verification (V2-13b, V2-13c):** they need jobs (V2-04), messaging (V2-12), purge machinery (V2-13) and the design system; because go-live is big-bang (PO-15), building them late loses nothing, and V2-14 verifies them. Coupons and refunds ride with them, because UAT testers enter through `uat` codes.
- **UAT last (V2-16):** it needs the verified, complete product on production; it ends with the Supabase upgrade and the UAT exit checklist, then G7.

**How the detailed plans map onto this sequence:**

| Detailed scheme | Maps to |
|---|---|
| SECURITY_REMEDIATION P0-1 to P0-9 | V2-01 (P0-8/9 as P1-15) |
| SECURITY_REMEDIATION P1-x | V2-05 (P1-1/2/3/4/8/16), V2-12 (P1-6/9/10; P1-9 re-pointed to AI-04/AI-05), V2-13 (P1-11/12), V2-15 (P1-14/15) |
| BACKEND Phase A (A1–A7) | V2-01 (A1–A5, A7, interim API PATCH guard from A6), V2-09a (A6 full) |
| BACKEND B / H | V2-01a + V2-02 (test lane), V2-03 (B1–B8, H1–H2), V2-04 (H3 alerts), V2-15 (H4 drain) |
| BACKEND C / D / E / F / G | V2-05 (C), V2-03 (D1 spike) + V2-07 (D2–D4), V2-08 to V2-11 (E per domain), V2-04 + V2-12 + V2-13 (F), V2-12 (G) |
| FRONTEND M0–M3 / M4.x / M5 | V2-02 (M0), V2-DX (prototypes), V2-06 (M1–M3 + PWA shell), V2-08 (M4.1–4.3), V2-09b/c (M4.4), V2-10 (M4.5), V2-11 (M4.6–4.7, M5) |
| TEST T-01–T-06 / T-07+ | V2-01a (T-01, T-06) / V2-02 (T-02 to T-05, device projects) / each phase's test plan; T-14 per workflow phase (P1-42) |
| INFRA I-01–I-05 / I-06+ | V2-00 (I-01 check) + V2-02 + V2-03 (staging) + V2-04 + V2-15 |
| SUBSCRIPTIONS_AND_PLANS §13 (SUB-01…11) and §14 (SUB-COUPON-01…08) | V2-00/01 (SUB-10, PO-side), V2-05 (SUB-01/02), V2-13b (SUB-03/04/05/08, SUB-COUPON-01/02/03/04/05/07), V2-13c (SUB-06/07/09, SUB-COUPON-06), V2-15 + V2-16 (SUB-COUPON-08); SUB-11 deferred (C41) |
| AI_STRATEGY §11 (AI-01…26) | V2-01 (AI-01), V2-02 (AI-06 L1), V2-05 (AI-03 DB, AI-06 L2 database part), V2-06 (AI-02, AI-16), V2-08 (AI-13/14), V2-09b (AI-07/09/10/15), V2-09c (AI-08/11), V2-12 (AI-03 app, AI-04, AI-05, AI-06 L3, AI-17), V2-05 (AI-18, C41), v2.1 (AI-12, AI-21…26) |
| AUTH_REDESIGN §11 (AUTH-00…09) | V2-01a (AUTH-00), V2-01 (AUTH-01, AUTH-04a), V2-03 (AUTH-02/03, AUTH-04b), V2-05 (AUTH-05, AUTH-06 backend), V2-11 (AUTH-06 UI, AUTH-08 clinic, AUTH-09), V2-13b (AUTH-07), V2-13c (AUTH-08 platform), V2-15 (AUTH-03 production) |
| PWA_STRATEGY §14 (PWA-01…13) | V2-DX (PWA-03a), V2-02 (PWA-08a), V2-06 (PWA-01/02/03/04/05/07/09), V2-07 (PWA-06a), V2-08/09b/10 (PWA-03b, PWA-06b), V2-09c/10 (PWA-12), V2-13b (PWA-05 lock path, spec 9), V2-08 + V2-15 (PWA-10), v2.1 (PWA-13) |
| Free-tier controls for UAT (FT-01…FT-08, §9.1) | V2-03 (FT-01 staging, FT-05, FT-07 sink), V2-04 (FT-02 on staging, FT-03, FT-04 job), V2-09c (FT-04 compression), V2-11 (FT-06, FT-07 auth events), V2-15 (FT-01 and FT-02 production, FT-08 runbook), V2-16 (FT-08 upgrade at UAT exit) |
| GSD "Phase 0 = foundations" | Overridden: containment comes first, but the local DB harness (V2-01a) precedes it |

**Data-migration safety (BACKEND §3, §12):**
- There is no production data to migrate (PO-1, PO-15). The read-only diagnostics still run on the test project before Phase C constraints, to catch logic that creates bad references.
- Never auto-correct money values in tests or seeds; fix the code that produced them.
- Public URL shapes and MSG91 template parameters are designed once in v2 and then treated as contracts from go-live.
- API v1 changes are additive from go-live onward (PO-16).

## 12. GSD milestone breakdown

### 12.1 Pre-requisites (before any GSD execution)

1. P0-09: Claude Code deny rules for `.env*`; replace `.planning/config.json` (GSD_WORKFLOW_ASSESSMENT §5.3).
2. **Install GSD for Claude Code** (PO-11 ✅; project-local, pinned, e.g. `@opengsd/gsd-core@1.16.0 --claude --local`; confirm the package name and flags with `--help` at install time). It is **not installed today**: only the Antigravity and OpenCode installs exist. **Retire `.agents/` and `.opencode/`** and remove the OpenCode/DeepSeek reviewer from `.planning/config.json`.
3. Correct the v1 REQUIREMENTS traceability ("implemented in v1, not production-verified"), then **archive v1** with `/gsd-complete-milestone` on `feature/v2` (tag `v1.0-mvp-baseline`, PO-11).
4. Create `CLAUDE.md` (draft in GSD_WORKFLOW_ASSESSMENT §6) and `docs/adr/`.
5. Run `/gsd-new-milestone` **v2.0** from *this approved roadmap only*, then `/gsd-map-codebase`.
6. Per phase: discuss → plan (plan-check) → **PO approval** → execute on `v2/phase-<n>-<slug>` → code review by an **isolated Claude reviewer agent** (PO-10; adversarial second reviewer for security phases) → `/gsd-secure-phase` for auth, RLS, billing and data phases → verify with **CI links** → PR to `feature/v2`.

Every phase below states the seven fields that prompt §11 requires: objective, scope, dependencies, expected changes, acceptance criteria, tests and verification evidence. GSD plans inherit them and refine them per task (GSD_WORKFLOW_ASSESSMENT §5.4). Each plan should be one reviewable PR. Thresholds marked **Assumption (validate)** are confirmed at G2.

### 12.2 Milestone v2.0: phases

**V2-00 Pre-flight** (prompt Phase 0, runs after G1) · S · gate G0
- *Objective:* make agentic work safe and traceable, and remove secrets that agents may have seen.
- *Scope:* P0-09, P0-07 (unconditional rotation), P0-16a (test project), P1-36 (GSD for Claude Code; retire `.agents/` and `.opencode/`), P2-04, P2-DOC (errata). PO-side in parallel: SUB-10 kickoff (KYC, GST registration, policy page drafts), SES domain, GCP project (§13 table).
- *Dependencies:* G1; PO-10 ✅, PO-11 ✅, PO-1 ✅.
- *Expected changes:* `.claude/settings.json`, `.planning/config.json`, `CLAUDE.md`, `docs/adr/`, the v1 archive, the tag, errata in `docs/v2/`, the hygiene items in P2-04. Secrets rotated in the provider dashboards and the local `.env`. No app code.
- *Plans:* 00-01 agent safety + config; 00-02 secret rotation + backup check; 00-03 GSD install + v1 archive; 00-04 CLAUDE.md + ADR folder + errata + P2-04 hygiene.
- *Acceptance:* a `.env` read is denied in a test session; GSD for Claude Code is installed and refuses commits on `main`; `/gsd-help` works; `.agents/` and `.opencode/` are removed; every secret in `.env.example` has a rotation date; P0-16a recorded.
- *Tests:* a manual deny-rule check and a post-rotation smoke check (old keys rejected), both recorded.
- *Evidence:* a log of the denied read; `git tag` output; config diff; the rotation record (names and dates only, never values); the backup/PITR record or the test-restore log.

**S0 v1 security hotfix** (out-of-band, only if PO-1 = live) · M · gate G-HF · **Not triggered (PO-1); kept as contingency only**
- *Objective:* close SEC-01/03/04/05 and ARC-06 on the live v1.
- *Scope:* P0-16a first; interim P0-01 (reject overrides), P0-02, P0-03, P0-04, P0-05, P0-06; `/api/v1` off if PO-16 = no consumers; interim API PATCH guard for signed visits (DB-13/API-04); then P0-07 rotation; P0-08 forensics.
- *Dependencies:* PO-1, PO-2, PO-16.
- *Expected changes:* small patches plus 1–2 migrations on `hotfix/v1-security-containment`.
- *Acceptance:* region, tier and PITR confirmed or a logical dump test-restored locally **before** any migration; every exploit in SECURITY_VERIFICATION §5-6 tagged P0 fails; v1 smoke flows pass.
- *Tests:* a scripted manual plan against a local stack (no CI exists yet).
- *Evidence:* the backup/restore record, a signed test record, the migration diff, the rotation record, the written incident decision ⚖.

**V2-DX Design exploration** (prompt Phase 2) · M · gate G2-D
- *Objective:* approve the visual and interaction direction from rendered evidence before any primitive is built.
- *Scope:* the prompt B3 design-skill exploration; a rendered "Clinic Paper" token palette (colour, type, spacing, en-IN numerals); high-fidelity mock-ups or interactive prototypes of **Today** and **Consult** at 360, **820, 1180** and 1280 px (PWA-03a); the app icon and theme colour (PO-19); low-fidelity mock-ups of the install sheet, offline page, signup → "Start trial" mandate step, `/settings/billing`, the locked pages and the `/platform` tenant list; "AI Assist" vs "Smart Assist" labels (AI-02), the AI "Preview" chip and the "Coming soon" row (PO-21), the "₹1,499 + GST" price display (PO-20); contrast checks.
- *Dependencies:* G1; DESIGN_SYSTEM, INFORMATION_ARCHITECTURE and UX_AUDIT §5 as inputs.
- *Expected changes:* design artefacts and a throw-away prototype sandbox that is never merged into `app/`. No production code.
- *Plans:* DX-01 design-skill exploration, palette and icon; DX-02 Today prototype (phone, tablet, desktop); DX-03 Consult prototype; DX-04 billing, onboarding, admin, install and offline mock-ups; DX-05 PO walkthrough (plus clinic users if PO-13 arranges them).
- *Acceptance:* the PO signs off the palette, icon, both prototypes and the billing/admin/install mock-ups; token contrast meets WCAG AA; the interaction targets in §4 are walkable in the prototypes.
- *Tests:* an axe run and a contrast check on the prototypes; a recorded walkthrough of the §4 interaction counts.
- *Evidence:* screenshots at 360, 820, 1180 and 1280 px, the contrast report, PO sign-off, walkthrough notes.

**V2-01a Local DB harness** (prompt Phase 3; precedes containment) · M · G3-partial
- *Objective:* an executable regression net on a local stack before any auth refactor.
- *Scope:* P0-10 (plan 02-01 of the earlier draft): `.env.test`, a global guard refusing non-local Supabase URLs, Vitest stops loading `.env`, migrations + synthetic seed, run-scoped teardown, and the existing 27 DB-backed suites running **unchanged** on `supabase start`; **AUTH-00** local spike (written note pinning `verifyOtp` types, `/otp` behaviour, the pre-account-hijack fix and session deletion).
- *Dependencies:* G0. No PO decision beyond PO-11.
- *Expected changes:* `vitest.config.ts`, `tests/helpers/**`, `supabase/seed*.sql` (synthetic), a test script. No app code.
- *Plans:* 01a-01 harness + non-local-URL guard; 01a-02 run and stabilise the existing DB suites locally; 01a-03 teardown; 01a-04 AUTH-00 spike note.
- *Acceptance:* all 69 files run locally with 0 failures attributable to the environment; 0 skipped in the DB lane; the guard aborts a run pointed at any non-local URL; zero tests reach a hosted URL.
- *Tests:* the existing suites themselves, plus a test that the guard rejects a hosted URL.
- *Evidence:* the local run log (counts produced by the runner, not hand-typed) and the guard test output. CI links become available in V2-02.

**V2-01 Security containment on `feature/v2`** (pulled forward from prompt Phase 5) · L · G3-partial
- *Objective:* the v2 branch never carries the backdoors.
- *Scope:* P0-01 to P0-06 (full versions), P1-23, the interim API PATCH guard for signed visits (DB-13/API-04), `/api/v1` disabled behind an env switch (PO-16 default); **AUTH-01** (delete OTP login paths and the dev shortcut) with **AUTH-04a** (minimal password sign-in and forgot password), so a working login always exists; **AI-01** (remove both copilots, the drawer, the mic and the mock provider; the scribe fails closed).
- *Dependencies:* **V2-01a** (the suites run before and after the override removal); G0; G1 + ADR-005 ratified. It does not wait for the rest of G2, because containment needs no design or frontend decision.
- *Expected changes:* the 16 `"use server"` modules' signatures, `server-only` services, the 4 non-action files' override parameters, migrations for memberships, tokens and SECURITY DEFINER functions, webhook route, token routes, lab-orders route, `app/api/v1/visits/[id]` guard, the rewired test helpers.
- *Plans:* 01-01 overrides → services (tests rewired off `sessionOverride`); 01-02 membership guard RPC; 01-03 webhook lockdown; 01-04 token binding + RPC; 01-05 lab-orders path + next patch + API PATCH guard; 01-06 AUTH-01 + AUTH-04a password login; 01-07 AI-01 containment.
- *Acceptance:* the grep/AST rule finds 0 override params; forged-override calls are rejected; a receptionist PATCH of `role` is denied; `/api/webhooks/messaging/dev` returns 404 or 401; a cross-tenant token returns 404; a PATCH of a completed visit through `/api/v1` is rejected; seeded users sign in by password and a normal login sends 0 emails (Mailpit); grep finds 0 `shouldCreateUser`/`devOtp`; no `/api/ai/*` copilot route is reachable; the existing suites pass on the local stack before and after.
- *Tests:* unit + DB integration (local) + new regression tests for each P0 exploit; the P0-13 guard enumeration lands in V2-02.
- *Evidence:* local runner logs for before/after; CI run links once V2-02 merges; the independent security reviewer's sign-off.

**V2-02 CI & e2e foundations** (prompt Phase 3) · M · G3-partial
- *Objective:* automated, CI-produced evidence for everything after this point.
- *Scope:* P0-11, P0-13, P1-27 (Playwright scaffold, characterisation e2e = M0 using password login, type-checked tests, removal of tautological tests), P1-41 (coverage reporting, report-only), PWA-08a (device projects: Desktop, Pixel 7, iPhone 15 in the PR lane; full matrix nightly), AI-06 L1 lane (AI copy and route greps). The L2 gating contract matrix needs the entitlement functions and lands in V2-05 (database part) and V2-12 (gateway part).
- *Dependencies:* V2-01 (override seams gone), V2-01a.
- *Expected changes:* `.github/workflows/**`, branch protection, `CODEOWNERS`, `eslint.config.*` (tooling dirs ignored), `tests/e2e/**`, `tsconfig` for tests, `tests/security/guard-*.spec.ts`.
- *Plans:* 02-01 CI pipeline + branch protection + CODEOWNERS; 02-02 guard enumeration test (P0-13); 02-03 Playwright + 6 characterisation flows + axe baseline; 02-04 test type-checking and quality clean-up; 02-05 coverage reporting.
- *Acceptance:* the PR lane is green with 0 skipped in the DB lane; adding an unguarded server action makes the guard test fail; the M0 baseline report is committed.
- *Tests:* the pipeline runs the full unit + DB lane; a deliberately unguarded fixture action proves the guard test fails; the 6 characterisation flows on v1 screens.
- *Evidence:* CI run links; the M0 baseline appendix (screenshots, axe reports, interaction counts).

**V2-03 Platform hygiene** (prompt Phase 3) · M-L · G3-partial
- *Objective:* reproducible schema, honest configuration, typed data, diagnosable failures, and a staging environment.
- *Scope:* P1-15, P1-21, P1-34, P1-35a (staging), P1-25 (error tracking + structured logger + request IDs), P1-43, P2-01 (Next 16 decision), P2-03, I-07, the **D1 confirmation spike** (C18); **AUTH-02** (auth config as code, drift check), **AUTH-03** on staging (SES + Send Email hook), **AUTH-04b** (change password, error mapping, safe `next`, `POST /auth/signout`, Turnstile) with the **FT-05** leaked-password check, and the AUTH-00 staging re-check; **FT-01** staging layout (Supabase Free in its own organisation, the v1 test project paused first, Vercel staging set up by the PO, with the `bom1` region check) and the **FT-07** event sink.
- *Dependencies:* V2-02; G2 (ADRs ratified); free-tier staging accounts created (PO-side task, §13; PO-17 ✅, FT-01), PO-19 ✅ (email domain), SES domain records (PO-side).
- *Expected changes:* `lib/env.ts` (zod schema), `lib/supabase/system.ts` (single factory) and removal of the other 4 factories, `supabase/migrations/` baseline + drift report, generated `types/database.ts`, ESLint boundary rules, `lib/datetime/**` and the 29 call sites, `lib/storage/**` (R2/S3 removed), `lib/log/**`, error-tracking config, staging project config, removal of `VITEST`/`NODE_ENV` branches, one RPC from the spike, `lib/auth/pwned.ts` (FT-05), event-retention settings (FT-07).
- *Plans:* 03-01 env schema + fail-closed providers; 03-02 single system DB factory; 03-03 baseline/drift (B1) + migration immutability + generated types; 03-04 ESLint boundaries + tooling ignores; 03-05 `lib/datetime` + replace the 29 sites; 03-06 Next 16 decision (PR or written deferral); 03-07 **D1 confirmation spike** (one atomic RPC end to end); 03-08 staging environment (FT-01); 03-09 error tracking + structured logger + request IDs; 03-10 R2/S3 removal + test-env branch removal; 03-11 AUTH-02 + AUTH-03 (staging); 03-12 AUTH-04b + FT-05 + AUTH-00 staging re-check.
- *Acceptance:* production boot fails without real providers; ESLint finds 1 service-role factory and 0 imports outside the allow-list; a fresh `db reset` matches the target schema (drift = 0 or documented); `tsc` passes with generated types; 0 UTC "today" sites; the spike report shows RLS, `auth.uid()` actor, audit and outbox in one transaction; staging deploys from CI; a thrown server error appears in the India-resident error sink with PII scrubbed; staging sends a **password-reset** code through SES with DKIM passing; Turnstile is on sign-in and reset (signup does not exist until V2-13b); `POST /auth/signout` clears the session server-side and returns `Clear-Site-Data: "cache"`; the auth config drift check is green; a password from the Pwned Passwords corpus is rejected by the change-password and reset actions (FT-05); staging functions run in `bom1`, or the deviation is recorded (FT-01).
- *Tests:* unit; IST boundary tests at 00:00–05:30; the env-schema boot test; the spike RPC's DB integration test incl. rollback on fault; a scrubber test; FT-05 unit tests with a mocked range API (hit, miss, API down).
- *Evidence:* CI links; the drift report (read-only against the hosted project); the spike report; a staging deploy link; an `ops.error_events` row export with scrubbed fields.

**V2-04 Jobs reliability** (prompt Phase 3) · M · G3-partial
- *Objective:* no duplicate or lost messages, and no lost data while Supabase runs on the Free plan.
- *Scope:* P0-12, P1-25 (alerts part), **FT-02** (backup job built and drilled on staging), **FT-03** (heartbeat), **FT-04** (quota monitor job).
- *Dependencies:* V2-02; V2-03 plans 03-08 (staging) and 03-09 (logging); PO-6, PO-17 ✅; an AWS account in `ap-south-1` (PO-side, shared with SES); pg_cron and pg_net confirmed on the staging Free project.
- *Expected changes:* a migration with the claim/lease/reaper RPC and the scheduler (pg_cron + pg_net, C22), `app/api/jobs/run/route.ts`, `lib/messaging/dispatcher.ts` and `lib/webhooks/dispatcher.ts` (inline dispatch removed), webhook idempotency keys, alert rules; the backup task as code (`ops/backup/`), the S3 bucket policy, heartbeat and quota-check jobs, `docs/runbooks/backup-restore.md`.
- *Plans:* 04-01 claim/lease/reaper RPC; 04-02 scheduler + `/api/jobs/run`; 04-03 remove inline dispatch + webhook idempotency; 04-04 dead-letter and lag alerts; 04-05 FT-02 backup job + first restore drill; 04-06 FT-03 heartbeat + FT-04 quota monitor.
- *Acceptance:* the parallel-dispatcher test shows 0 duplicate sends; a stuck `processing` row is reclaimed; queue lag p95 < 2 min in staging (**Assumption (validate)**); an alert fires in the staging drill; an encrypted dump of staging lands in the `ap-south-1` bucket twice a day and a deliberately failed run raises an alert; the first restore drill rebuilds staging data in a local stack and passes the pgTAP RLS suite, with RPO and RTO recorded; the heartbeat row is written every 6 h; the quota job reports database, Storage and MAU usage against the 60 %/70 % thresholds.
- *Tests:* concurrency (T-07 subset) with N parallel dispatchers; reaper test; MSW contract for MSG91; scheduler migration test on the local stack; the scripted restore drill; a quota-threshold unit test.
- *Evidence:* CI links; the staging alert-drill record; the restore-drill record in VERIFICATION_LOG; a bucket listing (object names and sizes only, never contents).

**V2-05 Database authorisation, integrity & entitlements** (prompt Phase 3/5) · XL · G3 (may be split at plan time into 05a role RLS and integrity, plans 05-01…05-04, 05-06, 05-08; and 05b membership, invites and entitlements, plans 05-05, 05-07, 05-09, 05-10)
- *Objective:* the database is the last line of defence, for roles **and** for subscription access.
- *Scope:* P1-01, P1-02, P1-04 (trigger part), P1-08, P1-10, P1-11, P1-39, P1-40, P2-08 (FK indexes), P0-14 backend part; **AUTH-05** (replaces P1-09); **AUTH-06** backend (replaces P0-15); **SUB-01** (product catalogue with billing models and GST-exclusive prices, entitlements, access functions, seeds, `comp_until`); **AI-18** (AI catalogue rows not purchasable, the 1,500-draft trial quota, the availability switch); **SUB-02** (hard stop in RLS and storage policies, guards, functional locked pages); **AI-03** DB part (opt-in, objection flag, kill switch, quota reservations); **AI-06 L2** database part (the gating contract matrix against `has_entitlement`, opt-in, objection, kill switch and quota).
- *Dependencies:* PO-3 ✅; V2-02; V2-04 (outbox, for invite emails); **V2-03 plan 03-03** (B1 drift baseline + generated types) and **plan 03-07** (D1 spike, for the audit triggers); **P0-16a recorded**; the diagnostics run.
- *Expected changes:* migrations for `has_permission()` (CASE over 5 roles, C19) and per-domain policies, composite FKs, RESTRICT, `memberships.status`, key revocation, referral and export rules, the exclusion constraint, the queue-token counter, FK indexes; `lib/permissions/**` parity test; invite delivery service; pgTAP files.
- *Plans:* 05-01 `has_permission()` + parity test + generated pgTAP matrix; 05-02 clinical-table policies per domain; 05-03 composite FKs (NOT VALID → VALIDATE); 05-04 RESTRICT + delete-policy removal; 05-05 AUTH-05 membership status, removal and revocation; 05-06 referrals + exports; 05-07 AUTH-06 invitations v2 backend; 05-08 exclusion constraint + queue-token counter + FK indexes; 05-09 SUB-01 schema, access functions, seeds and SQL runbook + AI-18 catalogue seeds; 05-10 SUB-02 enforcement (RLS, storage, guards, locked pages) + AI-03 DB.
- *Acceptance:* the pgTAP matrix covers 100% of tenant tables and passes; a receptionist PostgREST read of `clinical_notes` is denied (per PO-3); a cross-tenant child insert fails; a removed member reads 0 rows with a still-valid JWT; a receptionist can register a patient; two overlapping non-overbooked appointments cannot both be inserted; 50 parallel check-ins produce 50 distinct tokens with the IST date; with `p_now` past `access_ends_at`, a locked tenant gets 0 rows from every clinical table and storage bucket; `authenticated` cannot execute any `billing_internal.*` function; one invite sends exactly one email under retry; **after plan 05-10 (SUB-02) every existing DB suite stays green**, with all test tenants seeded `trialing` or comped; the seeded Standard price derives a 176882-paise charge from base 149900 and 1800 bp; no product is purchasable except Standard, `platform.set_product_availability` refuses `purchasable = true` for a product without an active provider price, and a `trialing` tenant has `ai.scribe` with a 1,500 limit while an `active` Standard tenant has none (PO-25 default). Note: from V2-05 onward `create_clinic_with_owner` creates `incomplete` tenants, so seeds must set a subscription row.
- *Tests:* the generated pgTAP matrix (roles × access levels); the `has_permission` parity unit test; time-travel pgTAP for trial, grace, expiry and archive; concurrency tests for check-in, booking and `ai_reserve`; invite pgTAP cases; migration tests on a copy seeded with the diagnostics' edge cases.
- *Evidence:* CI pgTAP report; diagnostics report; `/gsd-secure-phase` output; independent reviewer sign-off.

**V2-06 Design system, frontend foundation & PWA shell** (prompt Phase 3) · L · G3
- *Objective:* one enforced visual and interaction system, implementing the direction approved at G2-D, delivered as an installable PWA.
- *Scope:* P1-28 (M1–M3), P2-02 (bundle budgets), **PWA-01, PWA-02, PWA-03 (shell), PWA-04, PWA-05 (update/skew/lock client side), PWA-07, PWA-08b (specs 1–6, 8, 10, 11), PWA-09 (report-only)**, AI-02 (labelling), AI-16 (help search, if time permits).
- *Dependencies:* **G2-D**; V2-02 (M0); the Next 16 decision (V2-03 plan 03-06) before plan 06-02.
- *Expected changes:* `app/globals.css` tokens, font loading, `components/ui/**` (shadcn/Radix), `components/clinical/**`, the app shell, nav, command palette, `loading.tsx`/`error.tsx`/`not-found.tsx`, toasts, `/dev/ui`, grep guards, the hex-class codemod; `app/manifest.ts`, icons, `public/sw.js`, `/offline`, `hardSignOut()`, `/api/session-status`, install sheet.
- *Plans:* 06-01 tokens + fonts + codemod + AI/Smart Assist labels; 06-02 primitives (Radix/shadcn) with input modes + `/dev/ui`; 06-03 clinical components; 06-04 shell (safe areas, `dvh`), IA, palette, route states, toasts; 06-05 manifest, icons, service worker, offline page, `hardSignOut()`; 06-06 install UX, update/skew/lock handling; 06-07 bundle budgets + Lighthouse CI (report-only).
- *Acceptance:* axe shows 0 serious or critical issues on the gallery; screenshots at 360/820/1180/1280 (the V2-DX widths) match the G2-D direction and are approved by the PO; the grep guards, including the AI-02 "AI" copy grep, are in report mode; v1 screens still work (M0 e2e green); Chrome reports the app installable; the cache-audit spec finds no authenticated response in Cache Storage; every sign-out path clears caches and storage.
- *Tests:* Playwright screenshot + axe on `/dev/ui`; unit tests for primitives' keyboard and focus behaviour; the M0 characterisation suite.
- *Evidence:* CI links, the screenshot set, the bundle report, design review notes.

**V2-07 Atomic server commands** (prompt Phase 4) · L · G4
- *Objective:* every critical write is one transaction.
- *Scope:* P1-05, P1-04 (in-tx audit), BACKEND D2-D4, PR-5 to PR-7, **PWA-06a** (`client_request_id` idempotency on every write RPC).
- *Dependencies:* V2-05; the D1 spike report (V2-03).
- *Expected changes:* one migration per command group with plpgsql RPCs (`SECURITY INVOKER`); thin `server-only` service wrappers mapping errors to `AppError`; idempotency keys; the slots query.
- *Plans:* 07-01 sign-off, amendment, check-in; 07-02 invoice, payment; 07-03 walk-in, register+book, collect, slots query.
- *Acceptance:* fault injection after step 1 persists nothing; double-submit produces one record; concurrency tests pass; audit and outbox rows exist only for committed commands.
- *Tests:* DB integration per RPC (happy path, fault injection, RLS denial per role); concurrency tests; idempotency tests.
- *Evidence:* CI links.

**V2-08 Front desk** (prompt Phase 4) · L · G4
- *Objective:* a live, fast front-desk workspace in which the most frequent tasks meet the §4 interaction targets.
- *Scope:* P1-29, P1-30, P1-31, P1-20, P1-07, P1-12, P0-14 UI part (receptionist registration; QuickRegister includes the patient AI-objection field `ai_processing_objected` and the AI notice text, with placeholder wording finalised by AI-17 in V2-12, so the flow is not reworked later), P2-08 (trigram search index), P1-42 journeys for this phase (M4.1–M4.3); **AI-13** (slot suggestions), **AI-14** (duplicate detection), **PWA-03b** (tablet two-pane Today), **PWA-06b** (retry and SaveStatus), **PWA-10** early real-device run.
- *Dependencies:* V2-06, V2-07, PO-3 ✅.
- *Expected changes:* `app/(dashboard)/today/**`, `components/today/**`, PatientPicker + QuickRegister, booking/reschedule/cancel/no-show UIs and commands, the visit state machine, the clinic switcher, Smart Assist slot suggestions and duplicate detection, the search GET route, Realtime channel config; the v1 dashboard, queue and booking screens deleted as they are replaced (no flags, PO-15).
- *Plans:* 08-01 visit state machine + `/consultation/[id]` gate; 08-02 PatientPicker + QuickRegister + search endpoint; 08-03 Today workspace + Realtime/polling; 08-04 booking, reschedule, cancel, no-show (staff + patient fixes); 08-05 clinic switcher + Smart Assist slots and duplicates; 08-06 early real-device run.
- *Acceptance:* the M4 template (FRONTEND_MIGRATION_PLAN §3) is met; the two-tenant Realtime isolation test passes; the overbook path creates exactly one patient; slots are correct with the device TZ set to UTC; interaction targets are met; the receptionist can register a patient (PO-3); a timed-out walk-in retried with the same request ID creates one visit; the tablet layout matches the prototype at 744/820/1180.
- *Tests:* e2e golden paths on the device matrix (PWA §9.1), including journeys 2 and 3 (P1-42); the Realtime isolation test; state-machine unit and DB tests; slot tests across IST boundaries.
- *Evidence:* CI e2e links, axe report, PO walkthrough notes, the early real-device checklist record.

**V2-09a Clinical immutability & amendment** (prompt Phase 4, DB) · M · G4
- *Objective:* signed clinical records cannot change except through an audited amendment.
- *Scope:* P1-03 (DB and storage parts), BACKEND A6 (full).
- *Dependencies:* V2-05, V2-07 (amendment command).
- *Expected changes:* migrations with immutability triggers on signed visits, notes, prescriptions and items; the amendment RPC; storage policies (no member DELETE on lab documents); write-once PDF paths with SHA-256.
- *Plans:* 09a-01 immutability triggers + amendment RPC; 09a-02 write-once PDFs + hashes + storage policies.
- *Acceptance:* an UPDATE of a signed row is blocked except through amendment; an amendment creates a new version with an audit row; a finalised PDF cannot be overwritten; PDF hashes are stored.
- *Tests:* pgTAP immutability tests per role; amendment DB integration tests; storage policy tests.
- *Evidence:* CI pgTAP report; security reviewer sign-off.

**V2-09b Consult workspace & save model** (prompt Phase 4) · L · G4
- *Objective:* doctors never lose consult work, and the consult is keyboard-first.
- *Scope:* P1-32 (workspace part), P1-24 (in-consult upload dropzone), P1-42 journey 5; Smart Assist **AI-07** (terminology), **AI-09** (shorthand), **AI-10** (patient snapshot), **AI-15** (follow-up → proposed appointment); PWA-03b (two-pane consult) and PWA-06b. The AI Scribe is added in V2-12 (C37).
- *Dependencies:* V2-09a, V2-06.
- *Expected changes:* `app/(dashboard)/consultation/[id]/**`, `components/consultation/**` rebuilt from the 1,681-line workspace, draft versioning, the unload guard, explicit save state, conflict detection, the upload dropzone.
- *Plans:* 09b-01 save model (draft versions, conflict prompt, unload guard); 09b-02 two-pane workspace + templates; 09b-03 upload dropzone.
- *Acceptance:* kill the tab mid-note and the draft is restored up to the last server autosave (≤ 5 s; PWA D3, no PHI on the device); a concurrent edit shows a conflict prompt; an upload in the consult is stored and listed; each Smart Assist feature works with AI fully disabled; the PO completes a walkthrough.
- *Tests:* e2e for the consult journey at both viewports; save-model unit tests; conflict DB test.
- *Evidence:* CI e2e links, axe report, PO walkthrough notes.

**V2-09c Rx builder & PDF** (prompt Phase 4) · M · G4
- *Objective:* fast, safe prescriptions with a printable, trustworthy output.
- *Scope:* P1-32 (Rx part), P2-10 (Rx print stylesheet and letterhead), **AI-11** (allergy check, replaces P2-12: substance-level only; class-level deferred to v2.1 per PO-22), **AI-08** (Rx favourites fix), PWA-12 (camera capture, Web Share of the Rx PDF), **FT-04** client-side image compression for captured and uploaded documents, and the decision whether Rx PDFs are stored or regenerated on demand (Storage quota, §9.1).
- *Dependencies:* V2-09b, V2-09a.
- *Expected changes:* `components/prescriptions/**` keyboard Rx builder, the PDF template, print CSS, the allergy check against CDCI salt mapping.
- *Plans:* 09c-01 keyboard Rx builder; 09c-02 PDF + print stylesheet + letterhead; 09c-03 allergy check.
- *Acceptance:* a 3-drug Rx can be written without the mouse; the PDF matches the golden file and its hash is stored; a known allergen triggers an inline warning; SA-02 (Rx favourites) never returns another doctor's Rx (RLS/DB test); a phone photo is compressed below the agreed size budget before upload (FT-04).
- *Tests:* golden-file PDF tests; Rx builder e2e; allergy-check unit tests.
- *Evidence:* CI links, PDF samples, PO walkthrough notes.

**V2-10 Billing & collections** (prompt Phase 4) · M · G4
- *Objective:* billing is correct, GST-compliant and fast to collect.
- *Scope:* P1-06 (PO-4 ✅: cancel, void, refund, Indian-FY numbering), P1-33, P2-10 (receipt print), P1-42 journey 7, PWA-06b, PWA-12 (share the invoice PDF).
- *Dependencies:* PO-4 ✅, V2-07.
- *Expected changes:* billing migrations (status guards, money CHECKs, FY counter, one active invoice per visit), cancel/void/refund commands, `lib/money`, the collect UI and collections register, receipt print CSS.
- *Plans:* 10-01 invariants + FY counter; 10-02 cancel/void/refund; 10-03 collect UI + collections; 10-04 receipt print.
- *Acceptance:* an edit after payment is rejected; overpayment is rejected; refund and cancel flows work; FY numbering has no gaps under 50 parallel creates; amounts are formatted en-IN.
- *Tests:* concurrency tests; DB constraint tests; `lib/money` unit tests; e2e journey 7.
- *Evidence:* CI links, PO walkthrough notes.

**V2-11 Profile, registers, staff & settings, public pages** (prompt Phase 4) · M · G4
- *Objective:* complete the remaining screens on the new system and remove v1 UI.
- *Scope:* P2-05, staff lifecycle UI (AUTH-05), invites UI (AUTH-06), **AUTH-08 clinic side** (owner TOTP, `requireRecentAuth`, email change, owner transfer), **AUTH-09** (session policy, sign out everywhere, idle local sign-out) with **FT-06** (app-side time-box and inactivity on Supabase Free) and **FT-07** (auth events kept ≥ 180 days), P1-24 (labs relabel, PO-5 ✅), P1-42 journey 10, "Install app" and "Check for updates" entries, M5 cleanup and enforcement (palette reset, grep guards at error).
- *Dependencies:* V2-06, V2-05 (AUTH-05/06 backend), V2-08; PO-5 ✅.
- *Expected changes:* patient profile and history, paginated registers with URL filters, staff and settings pages, public token pages, the labs navigation label, deletion of v1 components, grep guards switched to error.
- *Plans:* 11-01 patient profile + history; 11-02 registers; 11-03 staff + invites + settings; 11-04 public token pages + labs relabel; 11-05 owner MFA, re-auth and session policy; 11-06 M5 cleanup.
- *Acceptance:* registers are paginated server-side; public token pages pass axe at 320 px; an owner can invite, suspend and remove staff end to end (invite email via Mailpit, set password, sign in); an owner can enrol TOTP and sensitive actions require aal2 once enrolled; a session older than 14 days or idle for more than 7 days is signed out by the app (FT-06, time-travel test); every remaining v1 component is deleted (no soak period, PO-15).
- *Tests:* e2e for staff onboarding (J-A2), MFA (J-A7) and journey 10; axe on public pages; grep guards at error in CI.
- *Evidence:* CI links, axe reports, the deletion diff.

**V2-12 Integrations, AI & API** (prompt Phase 4) · XL · G4 (may be split at plan time into 12a messaging, dependency majors and API, plans 12-01…12-04 and 12-08; and 12b AI, plans 12-05…12-07)
- *Objective:* messaging, the AI Scribe and the public API are safe, governed and contract-tested.
- *Scope:* P1-13, P1-14 (**appointment reminders only**, PO-8 ✅), P1-19, P1-26, P1-37 (P2 while PO-16 = no consumers), P2-09; **AI-03** app part (`requireEntitlement`, opt-in UI, objection flag UI, kill switch, the trial **"Preview"** label and note, PO-21), **AI-04** gateway + Vertex `asia-south1` adapter (supersedes P1-16), **AI-05** Scribe v2 (C37), **AI-06** L2 gateway part and L3 evals, **AI-17** provider setup and terms.
- *Dependencies:* V2-04, V2-05, V2-09b (save model); PO-8 ✅, PO-9 ✅, PO-16 ✅, PO-21 ✅, PO-22 ✅, PO-25; GCP/Vertex account and MSG91 templates (PO-side).
- *Expected changes:* governance at enqueue and send, appointment-reminder producers, `lib/integrations/ai` (gateway, pseudonymiser, Vertex adapter, `ai_calls`), the scribe UI with per-section accept, zod 4 + AI SDK + `@supabase/ssr` upgrades, the Postgres rate limiter, `withApi` + `api_authenticate()`, OpenAPI generation, masked webhook secrets.
- *Plans:* 12-01 messaging governance; 12-02 appointment reminders; 12-03 dependency majors; 12-04 Postgres rate limiting (P1-26; needed by the gateway); 12-05 AI gateway + gating + provider setup (AI-03/04/17); 12-06 Scribe v2 (AI-05); 12-07 L3 evals + kill-switch and outage drills (AI-06); 12-08 API hardening + webhook secret masking.
- *Acceptance:* opt-out, consent and quiet hours are enforced (tests); each appointment gets at most one reminder per window; no PII in the AI outbound body (MSW contract); Vertex calls go only to the `asia-south1` regional host; a non-entitled, opted-out, objected, over-quota or killed request returns its specific message and never calls the provider; during the trial the scribe carries the "Preview" chip and the note "AI features are in preview and not yet offered as a paid product", shows no quota meter, upsell or price, and still requires the owner's opt-in before the first draft; after the trial (PO-25 default) the scribe entry point is absent and the server denies `ai.scribe`; the L3 thresholds are met; API v1 contract tests are backward compatible; `npm audit --omit=dev` reports 0 high or critical; webhook secrets are not returned by the list action.
- *Tests:* governance unit and DB tests; MSW contracts for MSG91 and AI; API contract tests; rate-limit tests across two instances; the full CI suite after each major upgrade.
- *Evidence:* CI links, the audit report, the OpenAPI diff; AI-17 configuration evidence (Vertex context caching and request-response logging off, the ZDR request outcome, the GCP budget alert and Vertex quota set).

**V2-13 DPDP lifecycle** (prompt Phase 4/5) · L · G4
- *Objective:* retention and erasure are lawful, reviewed and reversible until approved.
- *Scope:* P1-17, consent v2, P2-11 (tamper-evident audit).
- *Dependencies:* PO approval of the retention schedule (PO-12: no counsel); V2-04 (jobs); V2-05 (RLS); P0-16a.
- *Expected changes:* retention policy table, purge/anonymise jobs with dry-run and two-person approval, restrict-vs-erase workflow + staff UI, storage deletion, RLS hiding erased rows, audit hardening triggers.
- *Plans:* 13-01 retention policy + dry-run reports; 13-02 erasure workflow + UI; 13-03 purge jobs with approval; 13-04 audit tamper evidence.
- *Acceptance:* dry-run purge counts reviewed; PO approval recorded after an isolated reviewer's check; erasure end to end on synthetic patients; erased rows hidden from non-owner roles; audit rows cannot be updated or deleted.
- *Tests:* DB integration for each job in dry-run and live mode on the local stack; pgTAP for erased-row visibility; e2e for the staff erasure UI.
- *Evidence:* CI links, the dry-run report, the approval record, the PO's retention-schedule approval.

**V2-13b SaaS subscriptions & billing** (new; prompt Phase 4) · XL · G4 (adversarial security review)
- *Objective:* a clinic can sign up, authorise an AutoPay mandate, use a 14-day trial with no restrictions, be debited ₹1,768.82 (₹1,499 + 18% GST) on day 15, renew, cancel at any time with access to the end of the paid period, and be stopped automatically and forcefully when access ends; a clinic can redeem one coupon code (free cycles, trial extension, `uat`, and percentage or fixed discounts once SUB-COUPON-03 is enabled), and the platform can refund a SaaS payment with a credit note (round 3).
- *Scope:* SUB-03 (Razorpay `BillingProvider`, checkout with PWA resume, webhooks), SUB-04 (lifecycle, reconcile, notices), SUB-05 (SaaS GST invoices), SUB-08 (owner billing UI, "₹1,499 + GST", AI "Coming soon"; no AI checkout: SUB-11 is deferred and AI-18 moved to V2-05, C41), **AUTH-07** (owner signup, onboarding state machine, post-login routing), **PWA-05** lock path end to end and **PWA-08 spec 9**; **SUB-COUPON-01, -02, -04, -05, -07** (coupons data layer, checkout redemption with deferred `start_at`, discount line and credit notes, refunds, owner code entry) and **SUB-COUPON-03** (flat offers; may slip past paid launch, C47).
- *Dependencies:* V2-04, V2-05 (SUB-01/02), V2-06, V2-10 (`lib/fy`), V2-12 (P1-13 for WhatsApp notices, P1-26 rate limiter for code validation), AUTH-03/04; **SUB-10 + PO-20 ✅** (Razorpay test-mode keys at minimum; live keys by V2-15, the GSTIN by G7); PO-21 ✅; SUB-D9/D10 adopted defaults (SUB §14.12).
- *Expected changes:* `lib/billing/**`, `app/api/webhooks/razorpay`, `app/(onboarding)/**` (signup → verify → clinic → "Start trial", with code entry), `/settings/billing`, `/billing/locked*`, `saas_invoices` (discount columns) and PDF, credit-note series, coupon, code, redemption and refund tables and RPCs, `refund.*` webhook handling, lifecycle job handlers, banners, env schema entries.
- *Plans:* 13b-01 provider interface + Fake + Razorpay adapter + webhook route; 13b-02 owner signup + onboarding + mandate checkout (AUTH-07, PWA resume); 13b-03 lifecycle tick, reconcile, notices; 13b-04 SaaS GST invoices; 13b-05 owner billing UI + locked pages + banners (incl. the AI "Coming soon" row); 13b-06 coupons data layer + redemption + deferred `start_at` (SUB-COUPON-01/02/07); 13b-07 discount line, credit notes and refunds (SUB-COUPON-04/05); 13b-08 Razorpay flat-offer spike and switch (SUB-COUPON-03, may slip).
- *Acceptance:* the full lifecycle signup → mandate → trial → day-15 debit → renewal → cancel at period end → lock passes as **time-travel DB tests plus the Fake-provider e2e** (`TEST_NOW`); **Razorpay test mode on staging** covers mandate authorisation, the first charge (`start_at = now + 15 min`), a failure leading to `pending`/`halted`, cancel, and real webhook delivery (renewal in test mode only if Razorpay supports a short plan interval, Unconfirmed, SUB §11); a failed debit enters `past_due` and locks after grace or `halted`; Turnstile is on signup; the signup code is delivered through SES on staging; a forged or replayed webhook is rejected and a duplicate event is processed once; a seeded divergence raises the reconcile alert; an open tablet of a locked clinic stops showing data within one poll interval (spec 9); an unverified email cannot create a clinic or a mandate; a repeat owner gets no second trial (SUB-D5, admin override works); SaaS invoice numbers are gapless per FY under parallel creation; the Razorpay test-mode plan amount is 176882 paise and the test debit equals it (nothing added by Razorpay); a SaaS invoice shows ₹1,499.00 taxable plus CGST + SGST (same state) or IGST (other state), totalling ₹1,768.82; every price label reads "₹1,499 + GST"; the billing page shows AI as "Coming soon" and no API or page lets a clinic buy an AI product; **coupons (SUB §14.10):** a `uat` or free-cycles code defers the first debit to the coupon date while the mandate is still authorised with the ₹5 token, a second code on the same subscription is refused (no stacking), code validation is rate-limited with uniform errors, a discounted invoice shows the discount line with GST on the discounted taxable value, a refund is idempotent (a retried call refunds once) and issues a credit note, and a Dashboard refund is imported by reconciliation; the three Unconfirmed Razorpay behaviours on the SUB §14.9 test-mode checklist are recorded.
- *Tests:* time-travel pgTAP (incl. coupon kinds, normalised code uniqueness, no stacking, redemption limits, forfeiture on cancel in trial); webhook contract tests with recorded Razorpay test payloads (incl. `refund.*`); `FakeBillingProvider` unit tests; e2e J-A1/J-A10, code entry and the billing journeys on the device matrix; concurrency test for invoice and credit-note numbering and for parallel redemptions of a single-use code; tax-split unit tests (intra- and inter-state, discounted bases, rounding to the paisa; **50 % coupon = 88442 paise intra / 88441 inter**); credit notes for an invoice sum exactly to it (full refund = exact reversal; final credit note takes the remainder); late UAT admission → `start_at = max(trial_end, free_until)`.
- *Evidence:* CI links; a Razorpay test-mode run record (IDs only) incl. the §14.9 checklist results; the R12 installed-PWA mandate check on Android and iOS; adversarial reviewer sign-off.

**V2-13c Platform admin & tenant data lifecycle** (new; prompt Phase 4) · L · G4 (adversarial security review)
- *Objective:* the PO can run the business without the SQL editor for routine work, and clinic data follows the agreed lifecycle: 30 days locked, then archive, then purge at expiry + 180 days, with an export offered first.
- *Scope:* SUB-06 (tenant data export), SUB-07 (archive and purge, reusing V2-13 machinery), SUB-09 (admin portal `/platform`), **AUTH-08 platform side** (mandatory TOTP with two factors, break-glass runbook); the Plans & prices screen also shows each product's billing model and the availability switch (PO-21); **SUB-COUPON-06** (Coupons screen and Refund action).
- *Dependencies:* V2-13b, V2-13 (P1-17), V2-04, AUTH-04.
- *Expected changes:* `app/(platform)/platform/**`, `features/platform/**` (lint boundary), `platform.*` RPCs and `platform_audit_log`, export job and private India bucket, archive/purge jobs, deletion certificate, runbooks (subscriptions SQL, break-glass).
- *Plans:* 13c-01 export job + function-limits spike; 13c-02 archive + purge with dry-run and approval; 13c-03 admin portal (tenant list/detail, trial extend, comp, overrides, reconcile now, lifecycle queue, Plans & prices screen); 13c-04 platform-admin MFA + break-glass; 13c-05 Coupons screen + Refund action (SUB-COUPON-06).
- *Acceptance:* a non-admin, or an admin at aal1, gets `forbidden` from every `platform.*` RPC; the admin portal shows no clinical data; an export downloads only in-app after re-auth and its URL expires in 15 min; a purge runs only after dry-run counts and approval, deletes clinic data and files, and leaves the statutory survivors (SUB §6.6); a re-purchase inside the archive window restores access instantly; the Plans & prices screen adds a new price version through `platform.create_plan_price` and changes trial length, grace and quotas without a deploy, each change written to `platform_audit_log`; toggling a product's availability is audited, and the screen refuses to make a product purchasable while it has no active price with a provider plan ID; an admin can create a coupon campaign and a batch of single-use codes, see redemptions, and refund a payment (with a re-auth prompt, an audit row and a credit note), and applying a code to an existing subscription creates the owner re-confirm task.
- *Tests:* pgTAP for platform RPC access and audit (incl. coupon and refund RPCs); job tests in dry-run and live mode on the local stack; e2e J-A8 and the admin journeys; storage deletion test.
- *Evidence:* CI links; dry-run and deletion-certificate samples; adversarial reviewer sign-off.

**V2-14 Security verification & closure** (prompt Phase 5) · M · G5
- *Objective:* independent proof that the Critical and High findings are closed and nothing new is open.
- *Scope:* the full SECURITY_VERIFICATION_PLAN: SAST, SCA, secrets, the authZ matrix, ZAP baseline on staging, an adversarial Claude security review, and no external test (PO-17 round 2: free-tier budget; recommended before scaling beyond the pilot); P1-18 (headers, CSP incl. `worker-src`/`manifest-src`), P2-06; verification of AUTH-08/09 (MFA, sessions); the new-track checks: webhook forgery and replay, platform RPC access from tenant sessions, `billing_internal` not client-executable, locked-tenant RLS and storage denial, share-token revocation on lock, export URL scope and expiry, AI gating bypass attempts and prompt injection against the scribe, proof that no AI purchase path exists (PO-21), coupon-code enumeration and brute-force attempts, redemption races and refund replay (SUB-COUPON), the FT-05 leaked-password check and the FT-06 session policy; triage of the unverified SEC items; P1-41 coverage enforcement.
- *Dependencies:* V2-01 to V2-13c merged; staging (V2-03); PO-17 ✅.
- *Expected changes:* security headers + CSP, SSRF and upload hardening, coverage thresholds switched to enforce, fixes from scanner and review findings.
- *Plans:* 14-01 headers + CSP; 14-02 P2-06 hardening; 14-03 auth, MFA and session verification; 14-04 scans + authZ matrix + ZAP; 14-05 billing, admin and AI abuse tests; 14-06 adversarial review + triage + fixes.
- *Acceptance:* 0 Critical/High open; Mediums fixed or risk-accepted by the PO; coverage floors met.
- *Tests:* the authZ matrix and pgTAP suite; header tests; MFA e2e; webhook replay tests; ZAP baseline in the nightly lane.
- *Evidence:* scanner reports, the adversarial review report, the triage log, CI links.

**V2-15 Production readiness & UAT launch** (prompt Phase 6) · M-L · G6 (UAT start)
- *Objective:* a controlled big-bang build (PO-15) of a new, verified production project, opened to real-world UAT clinics on Supabase Free with `uat` coupon codes (round 3, C46).
- *Scope:* P1-35b (new production project on Supabase Free in its own organisation, FT-01), P0-16b (runbooks + restore drill of an FT-02 production dump), **FT-02** production backups, FT-03/FT-04 live on production, **FT-08** (upgrade runbook and early-trigger watch), P1-25 (uptime; front-end log drain if available), P1-38, P1-41 (k6 + Lighthouse), I-10, AUTH-03 production (SES out of sandbox), **Razorpay live mode** (live plan IDs, webhook secret, real ₹5 mandate test), platform admin bootstrap, **SUB-COUPON-08** first part (`uat` campaign, assigned single-use codes, invite text, comp-access fallback runbook), PWA-09 budgets blocking, **PWA-10 final real-device run**, release docs, the UAT runbook.
- *Dependencies:* V2-14; PO-6/PO-7 ✅, PO-13 ✅, PO-17 ✅ (UAT scope); **SUB-10 KYC complete and live keys issued** (or the SUB §14.8 comp fallback); SUB-D9/D10 adopted defaults; SUB-D11 UAT exit date (PO operational input); MSG91 templates approved. The GSTIN is **not** needed for UAT start (no debit during UAT); it is a G7 item.
- *Expected changes:* production Supabase (Free) and front-end configuration (per C26), the production backup task and bucket, `docs/runbooks/free-tier-upgrade.md`, `docs/runbooks/uat.md` (codes, comp fallback, exit checklist), approval-gated migration jobs, reference-data seed (plans, prices, entitlement keys, platform admin, `uat` coupon campaign), Razorpay live configuration, SES production, uptime monitors, one backup runbook, incident runbook, `security.txt`, release notes, in-app help.
- *Plans:* 15-01 production environment + migration jobs + reference seed; 15-02 live payments + SES production + admin bootstrap; 15-03 uptime + alerts review (+ log drain where available); 15-04 restore drill + runbooks + FT-08 upgrade runbook; 15-05 k6 + Lighthouse; 15-06 real-device run + UAT campaign and codes + UAT runbook + release docs.
- *Acceptance:* §17 "UAT start" checklist fully met.
- *Tests:* k6 at go-live load; Lighthouse mobile; the restore drill; the nightly lane; the R1–R15 real-device checklist on 4 devices; a live mandate test; a live redemption of one `uat` code by the PO's own test clinic (deferred `start_at` visible in Razorpay, no debit beyond the ₹5 auto-refunded token).
- *Evidence:* the §17 UAT-start checklist with links, the drill record with RPO/RTO, the k6 report, the live-redemption record (IDs only), the G6 reviewer sign-off.

**V2-16 Real-world UAT & paid launch** (new, round 3; prompt Phase 6) · M · G7 (paid launch)
- *Objective:* real clinics use the complete product in daily practice free of charge under `uat` coupons; their feedback is triaged and fixed forward; production is then upgraded to Supabase Pro + PITR, and charging full-price customers starts only after G7.
- *Scope:* onboarding the UAT clinics (PO-13 pilot: 5 clinics × 3 users) with assigned `uat` codes (SUB-COUPON-08); weekly FT-04 quota review and FT-03 heartbeat watch; monthly FT-02 restore drill; feedback triage (bugs fixed forward through the normal PR flow with an isolated reviewer; new scope goes to v2.1, R12); refunds only as the exception (SUB-COUPON-05, SUB §14.8); AI preview for UAT testers with the owner opt-in (SUB-D10 default: until `free_until`); **FT-08 execution: Supabase Pro + PITR upgrade at UAT exit** (default; PO-26) with a PITR restore drill; GSTIN in `platform_settings`; the **UAT exit checklist** (SUB §14.8); paid-launch switch-over (codes closed to new redemptions, public pricing live).
- *Dependencies:* G6; V2-15; PO-26 (upgrade timing; default applies); PO-20 GSTIN issued before the first full-price debit; SUB-D11 UAT exit date (PO operational input). **G7 timing (addendum 4, fix 4):** G7 must pass at least 5 days before the earliest `uat` `free_until` (before the T-3 notices go out); otherwise the PO runs the SUB §14.8 slip runbook before T-3 (`comp_until` = new date, then cancel each affected subscription before its first debit; testers re-confirm AutoPay at paid launch). No debit may run without a GSTIN. **Late admissions:** a tester admitted less than 14 days before `free_until` gets `start_at = max(trial_end, free_until)` and converts at the end of their own trial (SUB §14.4).
- *Expected changes:* mostly data and configuration: Supabase plan, compute and PITR add-on; leaked-password protection and session settings switched on (AUTH §4.1); `platform_settings` (GSTIN, legal name, state); coupon campaign state; forward-fix PRs from UAT feedback; updated backup runbook and §17 evidence. No new features.
- *Plans:* 16-01 UAT onboarding + monitoring cadence (codes issued, invite text, quota and backup watch); 16-02 feedback triage and forward fixes (repeatable per batch); 16-03 Supabase Pro + PITR upgrade + PITR restore drill + hosted-settings drift check (FT-08); 16-04 UAT exit checklist + paid-launch switch-over + G7 review.
- *Acceptance:* §17 "Paid launch" checklist fully met; every UAT tester's first debit date and amount listed and their T-3/T-1 notices verified; no open Critical/High from UAT; production on Supabase Pro with PITR (7 days) and a PITR restore drill passed; GSTIN configured and a SaaS invoice PDF for the first real debit checked by the PO.
- *Tests:* the nightly lane stays green through UAT; each forward fix carries its regression test; the PITR restore drill; the hosted-settings drift check (AUTH-02) after the upgrade; reconciliation shows no divergence for the UAT tenants.
- *Evidence:* the UAT log (clinics, codes as IDs only, issues and their PRs), drill records (FT-02 monthly and PITR), the upgrade record, the UAT exit checklist, the G7 reviewer sign-off and the PO's paid-launch decision.

## 13. Dependencies and risks

**Critical path (sequential; team = PO + Claude, PO-18):** G1 → V2-00 → G0 → V2-01a → V2-01 → V2-02 → V2-03 (needs G2) → V2-04 → V2-05 → V2-06 (needs G2-D) → V2-07 → V2-08 → V2-09a → V2-09b → V2-09c → V2-10 → V2-11 → V2-12 → V2-13 → V2-13b → V2-13c → V2-14 → V2-15 → G6 (UAT start) → V2-16 (UAT, Supabase upgrade) → G7 (paid launch).

- **Execution model.** One GSD phase is in execution at a time. Claude may run isolated sub-agents inside a phase, but the PO's approvals and the review queue are the real constraint, so the plan does not count on phases running in parallel.
- **What does overlap** is PO-side work with external lead time. It starts right after G1 and must finish before the phase that needs it:

| PO-side task (owner: PO, Claude prepares) | Needed by | Lead-time note |
|---|---|---|
| Legal entity, PAN, current account, **GST registration (GSTIN; required before GST can be charged, PO-20)**, Razorpay KYC + Cashfree quote, public policy pages (SUB-10) | V2-13b (SUB-03 test keys), V2-15 (live keys for UAT mandates), V2-16 / G7 (GSTIN before the first full-price debit) | Longest external dependency; start immediately after G1 (approved 2026-11-10) |
| SES domain, DKIM/SPF/DMARC, sandbox exit (AUTH-03) | V2-03 (staging), V2-15 | Exit request can be delayed (AR-4) |
| MSG91 WhatsApp template approval for appointment reminders and billing notices | V2-12, V2-13b | Template review by Meta/MSG91 |
| GCP project for Vertex AI `asia-south1`, Google DPA, ZDR request, budget alert (AI-17) | V2-12 | ZDR outcome may take time (AIR-9) |
| Free-tier accounts (PO-17, FT-01): a Supabase organisation each for staging and production (Free); Vercel projects (handled by the PO, PO-24 closed); pause or delete the v1 test project first; AWS S3 bucket + scheduled task in `ap-south-1` for backups (FT-02) | V2-03 (staging), V2-04 (backups), V2-15 (production) | Same day |
| Supabase Pro + PITR upgrade of production (FT-08; timing PO-26, default at UAT exit) | V2-16, before G7 (or earlier on a §9.1 trigger) | Card on file only |
| UAT clinics recruited (PO-13 pilot) and the UAT exit date set (SUB-D11) | V2-15 (codes issued), V2-16 | Recruit during V2-14 |
| Real-device kit (PO-17 ✅, PWA D4) | V2-08 early device run, V2-15 | One low-end Android phone |
| Brand name, domain, icon (PO-19 ✅) | V2-DX (icon), V2-03 (email domain), V2-06 (manifest) | Renaming later is cheap but installed icons lag |

- V2-DX runs while V2-01a → V2-02 execute, because its work is PO review of prototypes, not code.
- S0 is not triggered (PO-1).

**External dependencies:** the PO account actions above; Razorpay activation; GST registration; MSG91 template approvals; Google Cloud (Vertex) terms; Supabase and AWS (SES, S3) plans and terms; Vercel (handled by the PO). No human reviewer and no counsel are in the plan (PO-10, PO-12).

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | v1 is live and was already exploited | **Closed (PO-1: not live)** | — | Guardrail in §1.4: no real-data deployment of v1 |
| R2 | The hosted **test** project is polluted by test runs (known shared password) | **Reduced:** leftover test users deleted 2026-11-10 (PO-14) | Low | P0-07 rotation, P0-10 local lane; the test project is retired after V2-01a |
| R3 | Schema drift between the hosted project and the migrations (edited 000007/000014) | Low (production is a new project built from v2 migrations) | Medium | B1 baseline in V2-03; production created from scratch in V2-15 |
| R4 | Existing cross-tenant references or overlaps block constraints | Low (test data only) | Medium | Diagnostics on the test project; synthetic seeds; no data migration into production |
| R5 | Behaviour regressions in the consult or checkout rebuild | High | High | Characterisation e2e (V2-02) before V2-08/09; port logic, not markup |
| R6 | Role-aware and access-aware RLS breaks legitimate flows or hurts performance | Medium | High | Generated pgTAP matrix including subscription states; `(select auth.uid())` pattern; access helper is one STABLE call per statement |
| R7 | plpgsql RPCs per flow become hard to maintain | Medium | Medium | RPCs limited to the atomic commands, billing transitions and `platform.*`; validation in zod; a DB test per RPC; D1 spike first |
| R8 | Immutability triggers break the amendment flow | Medium | High | Ship with the amendment RPC; PO walkthrough |
| R9 | Realtime + RLS tenant leakage, or a locked tenant still receiving Realtime events | Low–Medium | Critical | Private channels; two-tenant test; PWA spec 9 (lock while open) |
| R10 | Retention, archive or purge jobs delete data too early (irreversible) | Low | Critical | Dry runs, an on-demand FT-02 dump before every purge batch (PITR only after the Pro upgrade), admin approval per purge batch (SUB-D7), export offered first (SUB-06); archives can fall due inside the UAT window on Supabase Free (from about day 44 after UAT start: trial cancel → expiry day 14–18 → archive + 30 days); **purges cannot** (expiry + 180 days). While on Free, archive also takes an on-demand FT-02 dump first (archive deletes derived data irreversibly), and the archive export ZIP either counts against the 1 GB Free Storage quota (FT-04 includes export-bucket bytes) or goes to the S3 `ap-south-1` bucket |
| R11 | AI SDK / zod majors cause regressions | Medium | Medium | P1-19 with full CI; AI scope reduced to the scribe |
| R12 | Scope creep (now larger: subscriptions, admin, AI gating, PWA, auth) | High | High | New work is fixed by this roadmap; anything else goes to v2.1 (structured labs, vaccine reminders, copilots, voice, push) |
| R13 | Self-approval: all implementation and review is done by Claude (PO-10), so reviewer and implementer share blind spots | Medium | High | Isolated reviewer agents with no implementer context and read-only tools; CI-produced evidence only; adversarial review prompts for security phases; automated scanners (SAST, SCA, ZAP, pgTAP) as model-independent checks; real-world UAT (V2-16) as a further independent check; no external test (PO-17), recommended before scaling. **PO-accepted (round 3)** per PO-10 "Claude can review everything" |
| R14 | Breaking API v1 or WhatsApp contracts used by external consumers | Low (no live users; PO-16 default) | Medium | `/api/v1` disabled until PO-16 says otherwise; contract tests |
| R15 | Secrets in `.env` were exposed to third-party agent runtimes or models (W-02, G-2) | Unknown | High | Unconditional rotation in V2-00 (P0-07); deny rules (P0-09); production keys exist only in the new production project |
| R16 | ~~Deployment model undecided~~ | **Closed (PO-15: go-live after all of v2)** | — | — |
| **R17** | **Payment provider and mandate behaviour:** Razorpay UPI/eMandate subscriptions cannot be updated (every price, GST-rate, method or add-on change needs a new mandate); UPI Intent return inside an installed iOS PWA may lose the success callback; KYC or activation is delayed | Medium | High | Two-subscription add-on design (SUB §7.4); stateless return with server poll and webhook (PWA §6.6); access computed from timestamps, never from webhooks alone; reconciliation job; `BillingProvider` interface with a Cashfree fallback at M cost; KYC started right after G1 |
| **R18** | **RBI / NPCI rule changes** (e-mandate framework, AFA thresholds, UPI Collect deprecation, off-peak execution) change mandate or debit behaviour | Medium | Medium | Hosted checkout only (no VPA collect); pending-charge buffer (SUB-D4); configurable grace; rules re-checked at G6; the provider absorbs most rail changes |
| **R19** | **AI provider residency and continuity:** Google may keep pseudonymised prompts up to 90 days for abuse monitoring, possibly outside India (AIR-9); the regional model is retired or not offered in `asia-south1` (AIR-2) | Medium | Medium | Regional endpoint only; pseudonymisation; ZDR request; disclosure in AI terms; kill switch; scribe failure leaves manual notes untouched; Bedrock India adapter in v2.1 |
| **R20** | **PWA limits on iOS:** separate cookie jar in Home Screen apps, no install prompt, storage eviction, WebKit differences from emulation | High | Medium | Code-based OTP (no magic links); session-less invite links; no PHI on device; iOS instruction sheet; real-device checklist R1–R15 after V2-08 and at V2-15 |
| **R21** | **Bus factor of one:** the PO is the only human; Claude keeps no memory outside the repository; account access (Supabase, Vercel, AWS, GCP, Razorpay, MSG91, domain) sits with one person | High | Critical | Everything decision-relevant lives in the repo (`CLAUDE.md`, ADRs, runbooks, `.planning/`); provider accounts with MFA and recovery codes in a password manager with an emergency-access contact; two platform-admin TOTP factors and a break-glass runbook (AUTH-08); runbooks written so any Claude session can execute them |
| **R22** | **No legal counsel (PO-12):** DPDP role, notices, retention periods, AI terms and sub-processor disclosures are drafted by Claude only | Medium | High | Conservative defaults (DATA_HANDLING §5, SUB §6.6); India-region processing where available; sub-processor register. **PO-accepted (round 3)** per PO-12 (no counsel) |
| **R23** | **Clinical content without a clinician** (allergy classes, AI eval labels) | Medium | High | AI D-9 default: substance-level checks only and recorded risk acceptance (PO-22 ✅) |
| ~~R24~~ | ~~Front-end hosting plan terms~~ | **Closed (round 3): Vercel is handled by the PO personally (PO-24, C45)** | — | — |
| **R25** | **No backups or PITR on Supabase Free during UAT**: an operator error, bad migration or platform fault loses UAT clinics' data back to the last copy | Medium | Critical | FT-02 encrypted dumps twice a day in India (RPO ≤ 12 h), on-demand dumps before migrations and purges, monthly restore drill, early-upgrade triggers (§9.1); UAT clinics told to keep their own record during UAT; Pro + PITR before paid launch (G7) |
| **R26** | **Free-tier quotas and pausing**: over a quota the organisation can be paused, made read-only or answered with 402 after one grace period; a quiet week pauses the project | Medium | High | Separate organisations (FT-01), FT-03 heartbeat, FT-04 quota alerts at 60/70 %, upgrade at 60 % (§9.1) |
| **R27** | **Short platform log retention during UAT** (Supabase Free 1 h–1 day; front-end runtime logs short-lived): incidents cannot be investigated from platform logs, and CERT-In's 180-day expectation is met only through app tables | Medium | Medium | FT-07 in-app security and audit events ≥ 180 days; log drains after the upgrades; trigger 4 in §9.1 |
| **R28** | **No uptime SLA** on Supabase Free (or any plan below Enterprise) | Medium | Medium | Uptime monitor and alerts (P1-25); the scribe and billing degrade safely; UAT clinics informed; upgrade path in §9.1 |
| **R29** | **Coupon and refund mechanics (round 3):** Razorpay behaviours are Unconfirmed (offer effect on the ₹5 authorisation, maximum future `start_at`, expired offers on linked subscriptions); code leakage or brute force; a UAT tester is debited by mistake | Medium | Medium | SUB §14.9 test-mode checklist in V2-13b; comp-access fallback for UAT (SUB §14.8); single-use assigned codes and rate-limited uniform validation; T-3/T-1 debit notices; idempotent refund RPC with credit notes (SUB-COUPON-05); adversarial tests in V2-14 |

**Assumptions (validate):**
- Team = PO + Claude (PO-18). Claude performs all implementation and all independent reviews through isolated reviewer agents.
- New scope is limited to the PO decisions of 2026-11-10 and this roadmap.
- An initial go-live scale of 5 clinics × 3 users (PO-13 ✅).
- Supabase (Free during UAT, then Pro + PITR), SES, S3, Razorpay and Vertex AI in India are available to the PO's business entity (Vercel is handled by the PO); nothing in Supabase's terms forbids commercial use of the Free plan (no restricting clause found; the PO reads the Terms before go-live, **Assumption (validate)**). The Supabase DPA applies on the Free plan, since UAT clinics may enter real patient data (**Assumption (validate) before G6**).

**Outstanding investigations:** OI-1 to OI-10 in [VERIFICATION_LOG §3](VERIFICATION_LOG.md). Most concern the test project and are moot for production (PO-1). The unconfirmed external facts of the four new design documents (SUB §14, AI Sources, AUTH §12, PWA §2) are re-checked in the phase that depends on them.

## 14. Estimated complexity and effort

Relative sizes only. **S** = a single area or file group, one reviewable PR. **M** = several files or a migration, a handful of PRs. **L** = cross-cutting, many PRs across domains. **XL** = multi-phase programme work; a phase sized XL is at the upper bound and may be split at `/gsd-plan-phase` time (V2-05 → 05a/05b, V2-12 → 12a/12b) without changing the order. Phase sizes are at least the size of their largest item and grow with the number of M items they hold (re-sized after the final review: V2-01 M→L, V2-05 L→XL, V2-12 L→XL, V2-13b L→XL). No calendar estimates are given. With a team of PO + Claude (PO-18), phases run **in sequence**; the PO's review and approval turnaround and the external lead times in §13 drive elapsed time more than coding effort does.

| Phase | Size | Main driver of effort | PO hands-on |
|---|---|---|---|
| V2-00 Pre-flight | S | Configuration, rotation, GSD install, archive | Secret rotation in dashboards; start KYC (SUB-10) |
| S0 v1 hotfix | — | **Not triggered** (PO-1) | — |
| V2-DX Design exploration | M | Prototypes incl. tablet widths, install sheet, billing and admin screens | Approves G2-D; brand (PO-19) |
| V2-01a Local DB harness | M | Stabilising 27 DB-backed suites locally; AUTH-00 local spike | — |
| V2-01 Containment | L | 16 action modules + 4 other files; OTP removal + minimal password login; AI containment | — |
| V2-02 CI & e2e | M | Pipeline, guard test, e2e scaffold, device projects, AI L1/L2 lanes | — |
| V2-03 Platform hygiene | M-L | Drift baseline, types, staging (free tier), D1 spike, auth config as code, SES on staging, leaked-password check | Creates free-tier staging accounts; SES domain records |
| V2-04 Jobs reliability | M-L (was M; + FT-02 backups and drill, FT-03, FT-04) | Claim RPC + scheduler; self-run backups and the first restore drill | AWS bucket and scheduled task (with Claude's runbook) |
| V2-05 DB authorisation, integrity & entitlements | XL (split 05a/05b allowed at plan time) | Policy rewrite across about 40 tables + subscription access + entitlements + membership status | — |
| V2-06 Design system, FE foundation & PWA shell | L | Primitives, clinical components, installable shell, service worker | Approves screenshots |
| V2-07 Atomic commands | L | Critical flows as RPCs with idempotency keys | — |
| V2-08 Front desk | L | Today + booking + dedup + Smart Assist slots/duplicates | Early real-device run |
| V2-09a Clinical immutability | M | Triggers + amendment RPC | — |
| V2-09b Consult workspace | L | 1,681-line workspace, save model, Smart Assist | Walkthrough |
| V2-09c Rx builder & PDF | M | Rx keyboard flow, PDF, allergy check | — |
| V2-10 Billing & collections | M | Invariants, cancel/void/refund, FY numbering, collect | — |
| V2-11 Profile/registers/staff/settings | M | Many screens; invites UI; owner MFA; session policy | — |
| V2-12 Integrations, AI & API | XL (split 12a/12b allowed at plan time) | Messaging governance, appointment reminders, AI gateway + scribe, majors | GCP/Vertex setup; MSG91 templates |
| V2-13 DPDP lifecycle | L | Irreversible jobs, erasure workflow | Approves retention schedule |
| V2-13b SaaS subscriptions & billing | XL (L-XL in round 2; + coupons, discounts, credit notes and refunds, SUB-COUPON-01…05/07, about L; split 13b-i billing / 13b-ii coupons and refunds allowed at plan time) | Razorpay integration, webhooks, lifecycle jobs, GST-exclusive invoices, owner signup, coupon redemption with deferred `start_at`, refunds | KYC done; test-mode §14.9 checklist |
| V2-13c Platform admin & tenant data lifecycle | L | Export, archive/purge, admin portal incl. Plans & prices and Coupons screens, Refund action, admin MFA | Bootstraps admin TOTP |
| V2-14 Security verification | M | Scans, authZ matrix, ZAP, adversarial reviews; no external test (PO-17) | Risk acceptances |
| V2-15 Production readiness & UAT launch | M-L | New production project on Supabase Free, live payments, drill, upgrade and UAT runbooks, `uat` codes, device runs | Final device run; recruits UAT clinics; UAT-start go/no-go (G6) |
| V2-16 Real-world UAT & paid launch | M | UAT monitoring and forward fixes, Supabase Pro + PITR upgrade, PITR drill, UAT exit checklist | Runs UAT with clinics; Supabase upgrade (PO-26); GSTIN (PO-20); paid-launch go/no-go (G7) |
| **Milestone v2.0** | **XL** (unchanged in round 3: coupons and refunds, about L, and the UAT stage, about M, are absorbed within XL; round 2 had offset the removed AI add-on billing against FT-01…FT-08) | | |

**Assumptions:**
- Labs stays document upload (PO-5); structured labs is v2.1.
- AI scope is the scribe (trial Preview only, not sold; PO-21) plus deterministic Smart Assist (PO-9 per AI_STRATEGY).
- Supabase Free only during the real-world UAT stage (PO-17 as scoped by round 3); Pro + PITR from UAT exit (PO-26 default). Vercel is handled by the PO (PO-24 closed).
- UAT testers use `uat` coupon codes; refunds only as the exception (SUB §14.8).
- Reminders are appointment reminders only (PO-8).
- Native apps and web push are out of scope (PWA D2).

## 15. Acceptance criteria (milestone v2.0)

The milestone is accepted when **all** of the following hold. Each is evidenced by CI links or recorded artefacts; hand-typed results are not accepted.

1. **Security.**
   - No `"use server"` export takes override parameters.
   - One service-role factory with a lint-enforced allow-list.
   - 0 Critical/High findings open.
   - The authZ matrix is 100% green, including platform-admin RPCs and `billing_internal` functions being non-executable by clients.
2. **Tenant isolation.**
   - The pgTAP RLS matrix covers 100% of tables with `tenant_id`, auto-generated from `information_schema`, across roles **and subscription access levels**, all passing.
   - The two-tenant e2e and Realtime tests pass.
3. **Integrity.**
   - Composite FKs and CHECK and exclusion constraints are VALIDATED in production.
   - Signed records are immutable except through amendment.
   - Every critical write is one transaction, with audit and outbox inside it, and is idempotent by `client_request_id`.
4. **Jobs.** 0 duplicate sends in concurrency tests; the scheduler is live with alerts; governance is enforced; appointment reminders are sent once per appointment and window.
5. **Product.**
   - PO-3 role matrix implemented and tested (journey 8), **including receptionist registration**.
   - Invites delivered by email (AUTH-06).
   - Multi-clinic users supported.
   - Reschedule (staff and patient) correct in IST.
   - Billing invariants enforced, with cancel, void and refund and FY invoice numbering (PO-4).
   - Labs labelled honestly as documents (PO-5).
6. **Authentication (AUTH).**
   - Daily login is email + password; email OTP is sent only for owner signup verification and forgot password (plus the owner email-change exception, PO-23); 0 emails on a normal login (Mailpit test).
   - Staff removal cuts data access immediately (pgTAP with a still-valid JWT).
   - Platform admins require TOTP (aal2) with two factors enrolled.
7. **Subscriptions and data lifecycle (SUB).**
   - Signup → mandate → 14-day trial → first debit on day 15 → renewal → cancel at period end → hard stop → 30-day locked window → archive → purge at expiry + 180 days, all passing as time-travel DB tests and the Fake-provider e2e (`TEST_NOW`). Razorpay test mode on staging covers mandate authorisation, the first charge (`start_at = now + 15 min`), failure → `pending`/`halted`, cancel and webhook delivery; renewal in test mode only if Razorpay supports a short plan interval (Unconfirmed).
   - A locked tenant gets no clinical data through RLS, storage, server actions, `/api/v1` or Realtime, even on an open tablet (PWA spec 9). The lock is enforced at the data layer the moment `access_ends_at` passes; an already-open tablet UI notices it within the 5-minute poll (or on the next action or resume), and no data request succeeds in between.
   - Webhooks are signature-verified and idempotent; the reconciliation job detects a seeded divergence.
   - SaaS GST invoices are numbered by Indian financial year, and the GST-exclusive price is invoiced as ₹1,499.00 + GST = ₹1,768.82 with the correct CGST/SGST or IGST split (PO-20).
   - Plan price, tax rate, trial length, grace, quotas and product availability are changed without a deploy, from the admin portal's Plans & prices screen (SUB-09) or, as the fallback, the SQL runbook RPCs.
   - **Coupons and refunds (round 3):** the SUB §14.10 criteria pass: one coupon per subscription, no stacking; free time defers `start_at` with the ₹5 mandate still authorised; invoices show the discount line with GST on the discounted taxable value; refunds are idempotent with a credit note and audit; codes are managed from the Coupons screen (SUB-COUPON-06).
8. **AI gating (AI).**
   - The base plan has no LLM feature; `ai.*` requires entitlement, a one-time owner opt-in (C48), no patient objection, quota and the kill switch, enforced on the server.
   - No AI product can be bought in v2.0 (PO-21): AI shows "Coming soon" on plan and billing pages; during the trial the scribe is labelled "Preview" with the preview note and a 1,500-draft quota; post-trial behaviour follows PO-25.
   - LLM calls go only to the Vertex `asia-south1` regional endpoint with pseudonymised input; Google DPA accepted; the L3 eval report attached.
   - Deterministic features are labelled "Smart Assist" and never "AI" (CI copy grep).
9. **UX and PWA.**
   - The 10 e2e journeys pass on the device matrix (PWA §9.1) with 0 serious or critical axe violations.
   - Interaction targets met (§4); route and Lighthouse budgets met and blocking.
   - Installable on Android Chrome and iOS/iPadOS Safari; standalone launch to the role home; no PHI in Cache Storage or web storage (cache audit spec); real-device checklist R1–R15 passed on 4 devices.
   - No client-side multi-action chains.
10. **Design system.** Grep guards at error level; Tailwind default palette reset; no `[#hex]` or `text-[Npx]` in `components/` or `app/`.
11. **Quality.**
    - CI green, with 0 skipped in the DB lane.
    - Tests are type-checked.
    - Coverage floors met (thresholds confirmed at G2; enforced in CI by P1-41).
    - `npm audit --omit=dev` shows 0 high or critical.
12. **Privacy.** Retention, archive, purge and erasure jobs running with dry-run and approval; the retention schedule approved by the PO (no counsel, PO-12); privacy notice, sub-processor register (Supabase, Vercel, AWS SES, MSG91, Razorpay, Google Vertex AI) and AI terms published.
13. **Documentation.** ADRs recorded; `CLAUDE.md` matches the approved architecture; runbooks current (backup/restore, incident, subscriptions SQL, platform-admin break-glass, AI kill switch, free-tier upgrade, UAT incl. comp fallback and exit checklist).
14. **UAT and paid launch (PO-17 as scoped by round 3).** FT-01…FT-08 delivered; during UAT, twice-daily encrypted backups in India with a passed monthly restore drill and heartbeat and quota alerts live; UAT run with `uat` codes and the UAT exit checklist complete; production on Supabase Pro + PITR before the first full-price charge (G7).

## 16. Approval gates

Rule: **no implementer approves its own work** (prompt §13). Under PO-10 there is no human reviewer: every gate is reviewed by an **isolated Claude reviewer agent** (fresh context, no implementer transcript, read-only tools, its own checklist) and then **approved by the PO**. Security-sensitive gates (V2-01, V2-05, V2-07, V2-09a, V2-12, V2-13, V2-13b, V2-13c, V2-14) use a second, adversarial reviewer prompt. G4 is a light per-PR check; full gate reviews happen at G1, G2/G2-D, G3, G5, G6 and G7.

| Gate | When | Approver | Independent reviewer | Evidence required |
|---|---|---|---|---|
| **G-HF** | **Not triggered** (PO-1 = not live) | — | — | — |
| **G1** ✅ **APPROVED by the PO on 2026-11-10** with the round-2 amendments (free tiers, GST-exclusive price, no purchasable AI in v2.0, CAPTCHA on signup; VERIFICATION_LOG addendum 3) | Discovery accepted (prompt Phase 1) | PO | Isolated Claude reviewer of this roadmap and the four new design documents (the round-2 amendments themselves were applied by the planning agent and have not had a separate isolated review) | This roadmap + VERIFICATION_LOG; PO-1 to PO-23 answered or defaulted in writing (incl. PO-23(h) processing outside India); the new-track documents' **bodies** (not only their banners) reconciled to C33–C38; C13 **closed** and R13/R22 **PO-accepted** (round 3, addendum 4: no live data before V2-05 under the big-bang model; "Claude can review everything", PO-10; no counsel, PO-12); R23 accepted (PO-22 ✅). **ADR-005 ratification moved out of G1** into G0 |
| **G0** | End of V2-00 (after G1) | PO | Isolated Claude reviewer of the configs and of ADR-005 | `.env` deny verified; GSD installed for Claude Code and refusing `main` commits; `.agents/` and `.opencode/` retired; v1 archived truthfully; tag present; secret-rotation record; **ADR-005 ratified** (reviewed by the isolated Claude reviewer and signed off by the PO as part of G0; not a separate PO decision) |
| **G2** | Architecture approved (prompt Phase 2) | PO | Isolated Claude architecture reviewer | ADRs ratified (ADR-003 superseded; ADR-006/011 amended; new ADRs for subscriptions/entitlements, platform admin, AI gateway, auth, PWA data policy); FE-1 to FE-11 approved; acceptance thresholds confirmed |
| **G2-D** | Design direction approved, before plan 06-02 | PO | Isolated Claude design reviewer | V2-DX outputs at 360, 820, 1180 and 1280 px incl. billing, admin and install surfaces; contrast report; brand and icon (PO-19) |
| **G3** | Foundations complete (V2-01a to V2-06) | PO | Security reviewer agent for V2-01/V2-05; design reviewer agent for V2-06 | CI green with 0 skipped; pgTAP matrix (roles × access levels) green; jobs concurrency tests; drift report; screenshots and axe; installability report; `/gsd-secure-phase` outputs |
| **G4** (light, per PR) | Each phase merge V2-07 to V2-13c | PO (walkthrough for V2-08 to V2-10) | Isolated code reviewer per PR; adversarial security reviewer for V2-07, V2-09a, V2-12, V2-13, V2-13b, V2-13c | Phase acceptance list met; e2e on the device matrix; rollback of migrations tested locally |
| **G5** | Security verification complete (V2-14) | PO | Adversarial Claude security reviewer + automated scanners; no external tester (PO-17) | SAST/SCA/secret scans clean; authZ matrix 100%; ZAP baseline with no High; webhook forgery/replay and locked-tenant tests; findings triaged; risk acceptances signed by the PO |
| **G6** | **UAT start** (end of V2-15) | PO | Isolated Claude release reviewer | §17 "UAT start" checklist complete with links (Supabase Free variant); restore drill ≤ 30 days old (**Assumption (validate)**); Razorpay live mandate test passed (or the comp fallback chosen in writing); `uat` campaign and codes ready; real-device checklist passed |
| **G7** | **Paid launch** (end of V2-16) | PO | Isolated Claude release reviewer | §17 "Paid launch" checklist complete with links; UAT exit checklist (SUB §14.8); G7 passed ≥ 5 days before the earliest `free_until` or the slip runbook completed before T-3; production on Supabase Pro + PITR with a PITR restore drill passed (PO-26); GSTIN issued and configured; no open Critical/High from UAT |

## 17. Production-readiness criteria

Production is used in two steps on the same project (round 3, C46): **UAT start** (G6, end of V2-15) proceeds only when every §17.1 item is checked and linked to evidence; **paid launch** (G7, end of V2-16; the first full-price charge) proceeds only when §17.1 still holds and every §17.2 item is checked.

### 17.1 UAT start (G6)

**Security and privacy (both steps)**
- [ ] §15 items 1–3 met. Security verification done and triaged (no external test, PO-17). 0 Critical/High open.
- [ ] Keys rotated in V2-00. Production secrets exist only in the new production project and platform stores. No production keys on the PO's machine outside a password manager. `SUPABASE_ACCESS_TOKEN` not in the app env.
- [ ] Security headers + CSP (incl. `worker-src`, `manifest-src`) live. Rate limits enforced (incl. coupon-code validation). Dev shortcuts impossible in production (env schema).
- [ ] Privacy notice, Terms, Refund & Cancellation, Pricing and Contact pages published (SUB-10); sub-processor register and AI terms published; retention schedule approved by the PO (PO-12: no counsel).
- [ ] Incident runbook with the CERT-In 6-hour and DPDP breach templates. Security contact published.

**Infrastructure: Supabase Free during UAT** (PO-17 as scoped by round 3)
- [ ] New production Supabase project in Mumbai (`ap-south-1`) on the **Free plan in its own organisation** (FT-01); network restrictions and SSL enforcement on if the Free plan offers them (**Unconfirmed**); MFA on every provider account.
- [ ] Front end deployed by the PO (PO-24 closed); functions in `bom1` where available. Environments split. Secrets only in platform stores.
- [ ] **FT-02 live for production:** two consecutive encrypted dumps (database + Storage) in the `ap-south-1` bucket, failure alert tested; FT-03 heartbeat and FT-04 quota alerts live; FT-05/FT-06 verified in production; FT-07 retention configured.
- [ ] Upgrade runbook (FT-08) written; the planned upgrade date (UAT exit, PO-26) and the early-upgrade triggers (§9.1) on the PO's calendar.
- [ ] Approval-gated migrations; migrations reproducible from scratch in CI.
- [ ] Scheduler (pg_cron) live; queue-lag and dead-letter alerts tested by a drill; **lifecycle, reconcile and retention jobs scheduled and their alerts tested**.
- [ ] Error tracking (PII-scrubbed, India-resident `ops.error_events` sink), structured logs, FT-07 in-app event retention ≥ 180 days (plus a log drain where available), external uptime monitors.
- [ ] **Restore drill passed within the last 30 days** (an FT-02 production dump restored into a local stack with the pgTAP RLS suite green), with RPO (≤ 12 h) and RTO recorded. One truthful backup runbook.
- [ ] SES production access (out of sandbox) with DKIM, SPF and DMARC passing on the `auth.` subdomain; Send Email hook healthy.

**Subscriptions, payments and UAT codes**
- [ ] Razorpay in **live mode**: KYC complete, the live plan ID for Standard (base ₹1,499 + 18% GST, plan amount 176882 paise) in `plan_prices`, **no AI plan IDs** (no AI is sold, PO-21), live webhook secret configured and a live webhook verified on production. (If live mode is not ready: the SUB §14.8 comp-access fallback chosen by the PO in writing.)
- [ ] A real ₹5 mandate authorisation and its auto-refund verified with a UPI app and a card; cancel-at-period-end verified; one live `uat` redemption by the PO's own test clinic shows the deferred `start_at` and no debit.
- [ ] Mandate flow passed from the **installed PWA** on Android and iOS (R12).
- [ ] Lifecycle transitions (trial end, coupon-funded period, past due, expiry, archive, purge dry-run) verified on staging with time travel; reconciliation divergence alert tested.
- [ ] `uat` campaign with assigned single-use codes for the UAT clinics, `free_until` = the UAT exit date set by the PO (SUB-D11); comp-access fallback runbook and the refund exception path (SUB-COUPON-05) tested on staging.
- [ ] Platform admin bootstrapped with two TOTP factors; break-glass runbook tested.

**AI**
- [ ] Vertex `asia-south1` regional endpoint only; caching and request-response logging off; budget alert and quota set; kill switch drill done; L3 eval report attached.
- [ ] AI shown as "Coming soon" on plan and billing pages; the scribe labelled "Preview" with the preview note and a silent 1,500-draft quota; the one-time owner opt-in and patient objection enforced for preview use (C48); preview duration for UAT testers per SUB-D10 and post-trial behaviour per PO-25.

**Quality and PWA**
- [ ] TEST_STRATEGY §9 release criteria met. Nightly lane green for 7 consecutive days (**Assumption (validate)**).
- [ ] k6 at go-live load (PO-13) meets the confirmed p95 target. Lighthouse budgets blocking and green.
- [ ] Real-device checklist R1–R15 passed on 4 devices (incl. one low-end Android) and scored by an isolated reviewer agent; install, sign in, reopen and sign out verified.

**Product and operations**
- [ ] Role matrix (PO-3) tested. Owner signup → trial (with a code) and staff onboarding work end to end in production (signup code and invite email received).
- [ ] MSG91 appointment-reminder templates approved; the production provider configured; readiness reports real providers.
- [ ] Release notes, an in-app help page, a support contact, a UAT feedback channel, and a rollback plan (Vercel instant rollback; migrations forward-fix, or restore from the latest FT-02 dump).
- [ ] UAT clinics, success metrics (interaction counts, error rate, message delivery, UAT-to-paid intent) and the UAT-start go/no-go decision recorded by the PO.

### 17.2 Paid launch (G7)

All of §17.1 still holds, plus:
- [ ] **Supabase Pro on the production organisation** (timing per PO-26; default at UAT exit, before the first full-price charge), compute at least Small, **PITR enabled (7 days)**, leaked-password protection and session time-box/inactivity on, log retention or drain configured, hosted-settings drift check green.
- [ ] **PITR restore drill passed** with RPO (about 2 min) and RTO recorded; backup runbook updated; FT-02 dumps continue as the off-platform copy.
- [ ] **GST registration complete and the GSTIN, legal name and state in `platform_settings`** (PO-20); a SaaS invoice PDF showing ₹1,499.00 + GST = ₹1,768.82 (and one with a discount line, if any discount is live) checked by the PO; every price label reads "₹1,499 + GST".
- [ ] **UAT exit checklist** (SUB §14.8, SUB-COUPON-08) complete: every `uat` redemption's first debit date and amount listed; T-3/T-1 notices verified; refunds and credit notes (if any) reconciled; `uat` codes closed to new redemptions.
- [ ] **G7 passed at least 5 days before the earliest `free_until`**, or the G7-slip runbook (SUB §14.8: `comp_until` + cancel before first debit) completed before the T-3 notices; no debit can run without a GSTIN.
- [ ] No open Critical/High issue from UAT; every UAT fix merged with its regression test and isolated review.
- [ ] The PO's paid-launch go/no-go decision and the first full-price clinics recorded.

---

**Next step: G1 is approved (2026-11-10). Start V2-00 (agent safety, secret rotation, GSD for Claude Code, v1 archive, `CLAUDE.md`, CI groundwork, ADR-005 ratification) towards G0; V2-01 onward needs G0. PO-side: start Razorpay KYC (live mode needed at UAT start) and GST registration (needed before paid launch) now. Open product decisions: PO-25 only (default: AI preview ends with the trial; needed before V2-12); PO-26 = confirm the Supabase upgrade timing (default: at UAT exit, before the first full-price charge). PO operational input before V2-15: the UAT exit date (SUB-D11).**
