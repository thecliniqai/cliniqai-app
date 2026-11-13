# clinicOS v2.0: Verification Log

| | |
|---|---|
| Date | 2026-11-10 |
| Purpose | An independent check of every high-impact claim in the v2 discovery documents. This log is the evidence base for `V2_MASTER_ROADMAP.md`. |
| Inputs | 91 claims taken from 14 assessment documents. Each was re-derived from the code by a separate verifier agent that had none of the original author's context. A cross-document consistency review (30 contradictions) was also run. |
| Status | Discovery only. No application code, schema or configuration was changed. |

**How to read this log.**
- **CONFIRMED**: the claim holds as written.
- **PARTIALLY_CONFIRMED**: the core defect is real, but the scope, a count, a severity or a sub-claim needed correcting. Use the *corrected* claim.
- **REFUTED** or **UNVERIFIABLE** at the claim level: none (see the tally below). Refuted *sub-claims* are listed in §2, and the hosted-environment questions that could not be checked are listed in §3.
- **Final sev / pri** is the ruling of the roadmap author (the "Principal Architect" role in the same authoring pipeline) after reconciling the verifier's suggestion with the other documents. Where it differs from the verifier, the reason is in roadmap §10.2, where rulings are keyed by contradiction ID (C-xx). **These rulings are not independently approved.** They are pending the independent review required at G1 (roadmap §16; see §5 below).

## Tally

| Verdict | Count |
|---|---|
| CONFIRMED | 40 |
| PARTIALLY_CONFIRMED | 51 |
| REFUTED (whole claim) | 0 |
| UNVERIFIABLE (whole claim) | 0 |
| **Total** | **91** |

SEC-01 was moved from CONFIRMED to PARTIALLY_CONFIRMED after the independent roadmap review (C31). The verifiers found no claim to be wholly false. They did correct many sub-claims. The most common corrections were overstated scope (for example invoice PDFs, `tenant_id` moves, "all tenants" dispatch), wrong counts, and severities. In 4 cases the verifier found the defect was **worse** than claimed: SEC-08, SEC-19, ARC-03 and SEC-15 (the dev webhook).

---

## 1. Verified findings

Abbreviations: C = CONFIRMED, PC = PARTIALLY_CONFIRMED. Cr = Critical, H = High, M = Medium, L = Low. Paths are repo-relative.

### 1.1 Security (SECURITY_ASSESSMENT.md, THREAT_MODEL.md, DATA_HANDLING.md)

| ID | Original claim (short) | Verdict | Corrected claim (short) | Final sev / pri | Verifier evidence |
|---|---|---|---|---|---|
| SEC-01 | Client-supplied `sessionOverride` skips `requirePermission` and, in six browser-reachable actions, switches to the service-role client. The result is an unauthenticated cross-tenant read and write. | PC | The defect is as stated, but browser reachability is confirmed for **4** of the six actions: `searchPatients` (5 client importers), `updateClinicSettings`, `updateStatutorySettings` and `toggleGlobalConsent`. `getPatient` is imported only by the server page `app/(dashboard)/patients/[id]/page.tsx`, and `getPatients` has no importer, so their exposure is pending OI-6 (C31). Middleware blocks nothing. The only precondition is knowing a tenant UUID, and that UUID leaks through storage paths. `searchPatients` returns at most 25 rows per call, but the query string is arbitrary, so repeated calls can enumerate patients. | **Cr / P0** | `features/patients/actions.ts:168-176,247-264,274-279`; `features/settings/actions.ts:28-50,159-182`; `features/patients/consent.ts:156-166`; `lib/supabase/admin.ts:13-28`; `middleware.ts:4-53`; `app/(dashboard)/patients/[id]/page.tsx:2` |
| SEC-02 | `sessionOverride` on about 80 other actions bypasses the role check and spoofs the actor (RLS still bounds the tenant). | PC | There are 83 parameters. Role checks are bypassed, and `signed_by`, `recorded_by`, `created_by` and the audit `actor_id` can be spoofed (`actor_role` defaults to `owner`). `completeAndSignConsultation` is reachable only through `completeAndBillConsultation`. `updateStaffMember` is limited by RLS to the caller's own row. | **H / P0** (same fix as SEC-01) | `features/consultation/actions.ts:597-604`; `features/billing/actions.ts:184-187`; `lib/audit/audit.ts:168-190` |
| SEC-03 | Any member can PATCH their own `memberships.role` to `owner` through PostgREST. | C | As stated. Owners and admins can also demote any owner, which bypasses the last-owner guard that exists only in app code. | **Cr / P0** | `supabase/migrations/000011_fix_memberships_rls_recursion.sql:24-39`; `lib/auth/tenant.ts:42-45` |
| SEC-04 | The inbound webhook trusts the `dev` provider, unknown providers and any Twilio header. A cross-tenant phone `ilike` lookup with the service role lets unauthenticated callers confirm, cancel or reschedule any clinic's appointments. | C | As stated. Twilio passes only when `TWILIO_AUTH_TOKEN` is set. A `from` of `x` matches every patient. There is no future-date filter. The returned reschedule URL is probably dead because of SEC-32/F7. | **Cr / P0** | `lib/messaging/webhook-helpers.ts:30-86`; `app/api/webhooks/messaging/[provider]/route.ts:16-30,212-524`; `features/appointments/actions.ts:343-386` |
| SEC-05 | A member can mint share tokens for another tenant's resources. The resolvers fetch by ID with the service role. The reschedule routes do not check `resource_type`. | PC | The RLS gap and the missing tenant filter are real. The leak covers lab documents, prescription PDFs and patient names. **Invoice PDFs do not leak** (the path is tenant-scoped). Referral PDFs leak only if the path is set. The attack needs the victim's resource UUID. | **H / P0** | `000013_labs_and_referrals.sql:121-154`; `app/api/r/[token]/route.ts:26-197`; `app/api/reschedule/[token]/route.ts:24-240`; `features/billing/pdf/generator.ts:136-150` |
| SEC-24 | `npm audit --omit=dev` reports 10 vulnerabilities (9 high, 1 critical): next, postcss, zod. | C | The counts reproduce. 6 of the 10 are in the AI SDK chain (`ai`, `@ai-sdk/*`, `jsondiffpatch`), and fixing them needs a major upgrade. Next's critical image-optimiser RCE probably does not apply (no SVG config, no `next/image`). The Server Actions DoS does apply. There is no CI. | **H / P0** (next/postcss patch); **P1** (zod 4 + AI SDK majors) | `package.json:28,33,37`; `next.config.ts:1-7`; npm audit re-run |
| SEC-25 | The test suite and seed scripts create real users and tenants on a hosted project with the service-role key. | PC | Tests do (`tests/helpers/tenants.ts`). Seed scripts only upsert reference catalogs. `supabase/config.toml` already defines a local stack that nothing uses. Whether the hosted project is production cannot be checked statically. | **H (M if not prod) / P0** (confirm the target; local test lane) | `tests/helpers/tenants.ts:35-278`; `vitest.config.ts:5-15`; `scripts/seed-*.ts`; `supabase/config.toml:1-12` |
| SEC-06 | RLS isolates tenants but not roles. Any member can read and write clinical and financial tables. `audit_logs` insert checks the tenant only. Comms and notification tables are `FOR ALL`. | PC | Confirmed. One correction: `payments` has no UPDATE policy (members can INSERT but not UPDATE). | **H / P1** | `000003:64-97`; `000004:47-52`; `000006:104-121`; `000007:56-69,388-399`; `000009:94-128`; `000014:45-126`; `lib/permissions/matrix.ts:25-75` |
| SEC-07 | Staff cannot be offboarded. API keys outlive their creator. Sign-out is local only. | C | As stated. API-key sessions are always given role `admin`. | **H / P1** | `000001_foundation.sql:17,32-43,68-75`; `lib/api/auth.ts:76-80,142-150`; `components/layout/user-dropdown.tsx:24` |
| SEC-08 | Admin can escalate to owner. Owner invites can be inserted through PostgREST. `consume_invitation` is not bound to the invitee. Production invite links are never delivered. | PC | All confirmed, and **understated**: every role can self-promote (see SEC-03). | **H / P0** (fixed together with SEC-03) | `features/settings/schema.ts:89-99`; `000002_invitations_billing.sql:15,76-87,120-165` |
| SEC-09 | SECURITY DEFINER functions trust `p_tenant_id`. The invoice function is callable by anon. Concurrent calls produce duplicate GST numbers. | PC | No membership check, confirmed. The leaked data is low-sensitivity (formulary, counts). Supabase default grants probably give anon EXECUTE on all three functions. **Duplicate stored numbers are refuted** by `UNIQUE(tenant_id, invoice_number)`. The real effect is an insert failure plus a non-sequential `Date.now()` fallback. | **M / P2** (rides with the P0-02 migration if cheap) | `000006:76-96`; `000007:251-344`; `000009:17,25,63-83`; `features/billing/actions.ts:80-110` |
| SEC-13 | No security headers. Clickjacking is possible. Tokens leak through the Referer header. | PC | Missing headers confirmed. Referer leakage is overstated (modern browser defaults, `noreferrer` already used). HSTS at the edge cannot be verified. | **M / P1** | `next.config.ts:3-5`; `middleware.ts:4-66` |
| SEC-14 | Dev auth shortcuts are gated only by `NODE_ENV`, so any UAT or preview environment allows account takeover. | PC | The code matches the claim. Scope correction: `next build`, `next start` and Vercel previews force `NODE_ENV=production`, so exposure is limited to reachable `next dev` servers that hold a real service key. The invite-token part needs `staff:invite` permission first. | **M / P1** | `features/auth/dev-actions.ts:20-83`; `features/staff/actions.ts:44,85-98` |
| SEC-15 | Messaging silently defaults to a dev logger that writes PII to logs and to `.planning/dev-messages.txt`. | PC | Confirmed. "Webhook forces dev" is wrong (it is conditional). Also found: the `dev` webhook is unauthenticated in production. That issue is merged into SEC-04. The `.planning` log files were never committed. | **M / P1** (dev-webhook part: P0 via SEC-04) | `lib/messaging/index.ts:20-31`; `lib/messaging/dev-logger.ts:59-90`; `.gitignore:47-48` |
| SEC-16 | AI sends identifiable patient data to an LLM, the scrubber is never used, client messages can inject prompts, and there is an `app_metadata` fallback and no route check. | PC | (1)–(3) confirmed. The `app_metadata` fallback is server-controlled and RLS-bound, so the risk is only a stale role. Each tool calls `assertRoleAllowed`. Whether a DPA exists is a contractual question. | **M / P1** | `lib/ai/tools/operations-tools.ts:35-107`; `lib/ai/sanitizer.ts:45`; `app/api/ai/*/route.ts` |
| SEC-18 | Finalised PDFs are written with `upsert: true`, any member can overwrite them, and there is no hash. | PC | Confirmed for prescription and invoice PDFs. Lab documents are uploads, not signed documents, and they are also **deletable** by any member. "Signed" means finalised, not cryptographically signed. | **M / P1** | `features/prescriptions/pdf/generator.ts:91-108`; `000008_prescriptions_storage.sql:27-54`; `000013:30-80` |
| SEC-19 | The MSG91 webhook uses `===`, accepts the secret in the query string, has no replay protection and uses a cross-tenant phone fallback. | PC | All true, and the impact is **understated**: the dev, unknown and Twilio branches make the webhook route an unauthenticated control path. `replyMsgId` allows filter injection. | **H / P0** (merged into SEC-04) | `lib/messaging/webhook-helpers.ts:35-85`; `route.ts:291-318` |
| SEC-30 | DPDP erasure is only a flag, erased rows stay visible, and there is no purge job and no staff UI. | C | As stated. The webhook phone lookup also matches erased patients. Keeping clinical records is deliberate. The gap is minimising identifiers and purging after retention. | **M / P1** | `features/dpdp/erasure.ts:72-90`; `000003:63-67`; `app/api/v1/patients/[id]/route.ts:200-262` |

### 1.2 Product (PRODUCT_BASELINE.md)

| ID | Original claim (short) | Verdict | Corrected claim (short) | Final sev / pri | Verifier evidence |
|---|---|---|---|---|---|
| F1/D1 | The override seam allows unauthenticated read and write of any tenant. Found in 20 files. | C | **16** of the 20 files are `"use server"` modules. The other 4 are the three PDF generators (`features/{billing,prescriptions,referrals}/pdf/generator.ts`) and `features/dpdp/export.ts`. The vector is `sessionOverride` (`clientOverride` cannot be serialised). Duplicate of SEC-01. | **Cr / P0** | `features/patients/actions.ts:247-279`; 5 client importers of `searchPatients` |
| F2/D2 | Receptionists cannot register patients. | C | Every UI path calls `createPatient`, which requires `patients:edit`. RLS would allow the insert. Tests lock in the current behaviour. This is a functional blocker, not a security issue. | **H (functional) / P0**: decision PO-3 | `lib/permissions/matrix.ts:55-61`; `features/patients/actions.ts:35`; `tests/auth/rbac.spec.ts:42` |
| F3/D3 | Staff invitations never reach invitees in production. Tokens are not bound to the invitee's email. There is no revoke or resend. | C | As stated. The UI copy promises an email. | **H / P0** (launch blocker for multi-staff clinics) | `features/staff/actions.ts:69-97`; `000002:120-165`; `app/(dashboard)/staff/page.tsx:88` |
| F4 | Role enforcement exists only in the app. Members can bypass it through PostgREST and forge audit rows. | C | Confirmed. The scope is an insider within their own tenant, not cross-tenant. | **H / P1**: ruling C13 (the verifier suggested P0) | `000003:25-97`; `000007:367-523` |
| D4 | `notifyPrescriptionIssued` is an unauthenticated webhook injector. | PC | The defect is real, but the function is dead code. Next 15.5 probably does not expose unreferenced actions. If reached, the impact is spoofed events sent to the victim tenant's own webhooks. | **M / P1** (delete in the P0-01 batch) | `features/prescriptions/actions.ts:165-183`; `lib/webhooks/outbox.ts:11-60` |
| F5 | No scheduled jobs. Retries and delayed messages never process. Reminders are never produced. | PC | There is no scheduler in the repo, and no reminder producers (the refill reminder has no template at all). Message retries do go out opportunistically through inline dispatch. Webhook retries depend on cron. | **H / P1** (reminders); the scheduler is P0 (F-3a) | `app/api/cron/*/route.ts`; `lib/messaging/dispatcher.ts:63-135`; `lib/messaging/templates/mapping.ts:36-68` |
| F6 | Messaging governance and DPDP consent are never enforced. | C | Confirmed. Governance does not check `consent_records` even if wired in, and the consent UI wrongly says messages are suppressed. | **H / P1** | `lib/messaging/governance.ts:75-171`; `features/appointments/actions.ts:80-125` |
| F7/D6/D7 | Self-reschedule is broken: the token FK fails, slots are in UTC, and POST does no slot validation. | C | All three confirmed. The booked-slot filter also never matches. | **H / P1** (token part fixed in P0-04) | `features/appointments/actions.ts:151-182,390-411`; `app/api/reschedule/[token]/route.ts:116-241` |
| F8/D8 | Copilot "Confirm" for reschedule and cancel does nothing. | C | Confirmed. The UI shows "Slot Released" even though nothing changed. | **H / P1** | `components/ai/operations-copilot-drawer.tsx:123-148,347-390` |
| F9/D5 | Users with more than one clinic membership are locked out. | C | Confirmed. Nothing sets the cookie, and nothing guards against a second membership. | **H / P1** | `lib/auth/tenant.ts:55-76`; `app/(dashboard)/layout.tsx:21-29` |
| F10 | Labs is not implemented as specified, but is marked VERIFIED. | C | Confirmed. The verification document names a non-existent function. | **H / P1**: decision PO-5 (labs scope) | `000013` (3 tables only); `app/api/v1/lab-orders/route.ts:10-55`; `04-VERIFICATION.md:65-76` |
| D9 | WhatsApp replies are matched by phone across tenants and can cancel the wrong appointment. | PC | The primary match is by `replyMsgId`, scoped to the tenant. The phone match is only the fallback, but that fallback has every flaw listed. | **H / P0** (removed in P0-03) | `route.ts:288-392`; `features/appointments/actions.ts:10-21,343-383` |
| D10 | The `visit.completed` webhook sends `patient_id` and `doctor_id` as undefined. | PC | Only `patient_id` is undefined. `doctor_id` falls back to the signer. | **M / P2** (fixed with ARC-10) | `features/consultation/actions.ts:611-705` |
| D11/D12 | Queue and invoice numbers race, and walk-in can leave an orphan visit. | PC | The races are real (the unique constraints fail, with no retry). The invoice fallback is a lesser path. Walk-in is three calls. | **M / P1** | `000006:52,75-91`; `000009:17,25,63-84`; `components/queue/walk-in-drawer.tsx:178-202` |
| D13 | There is no visit state machine. Front desk can mark a visit completed. | C | Confirmed. Check-in does not validate status or date. | **H / P1** | `features/queue/actions.ts:24-252`; `components/queue/checkout-drawer.tsx:285` |
| D14 | Paid invoices stay mutable, overpayment is allowed, and there is no cancel or refund. | C | Confirmed, and worse: editing items un-cancels a cancelled invoice. | **H / P1** | `features/billing/actions.ts:184-628`; `features/billing/schema.ts:19-25` |
| D15 | Silent fallbacks to the dev messaging provider and a mock AI. | PC | Confirmed for messaging, SOAP drafts and catch-up summaries. The copilot routes fail rather than mock. | **H / P1** | `lib/messaging/index.ts:20-30`; `lib/ai/client.ts:43-225` |
| D16 | Inline `dispatchPendingQueue` processes all tenants with a non-atomic claim, causing double sends and latency. | PC | Confirmed. "All tenants" applies only to the service-role paths, though those are common (appointments). | **H / P0** (with F-3b). **Fixed in V2-04 (awaiting PO gate):** request paths only enqueue; the runner claims atomically per tenant (`tests/jobs/parallel-dispatch-db.spec.ts`, `tests/jobs/claim-grants-db.spec.ts`, `tests/security/p0-12-lint-gates.spec.ts`) | `lib/messaging/dispatcher.ts:33-148`; `features/appointments/actions.ts:10-22` |

### 1.3 Backend (ARCHITECTURE_ASSESSMENT.md, DATABASE_ASSESSMENT.md, API_ASSESSMENT.md)

| ID | Original claim (short) | Verdict | Corrected claim (short) | Final sev / pri | Verifier evidence |
|---|---|---|---|---|---|
| ARC-01 / API-01 | Same as SEC-01, plus 87 occurrences of `sessionOverride?`. | C | Confirmed. The count is 89 occurrences in 20 files (16 `"use server"` modules). `getPatient` is imported only by server code and `getPatients` by nothing, so production-build exposure is not verified. The PDF generator is not a `"use server"` module. | **Cr / P0** | `features/patients/actions.ts`; `.next/server/server-reference-manifest.json` (dev build) |
| ARC-02 / RLS-01 | Self-promotion through `memberships`, including moving `tenant_id`. | PC | Self-promotion is confirmed. `tenant_id` can move only to a tenant the user already belongs to. `user_id` is unconstrained. | **Cr / P0** | `000011:23-39`; `000002:15,76-87,123-169` |
| ARC-05 / DB-05 | Polymorphic share tokens let tenant A download tenant B's prescriptions and invoices. | PC | Prescriptions, referrals and lab documents leak (a 600-second signed URL plus the patient name). Invoice PDFs do not; only the invoice number and patient name leak. | **H / P0** (ruling C11) | `app/api/r/[token]/route.ts:22-197`; `features/billing/pdf/generator.ts:140-147` |
| ARC-06 / API-05 | `POST /api/v1/lab-orders` accepts any `storage_path` and enables a cross-tenant signed URL. | PC | Injection confirmed. The service-role signing happens on the share route (and on R2). In-app signing uses RLS. The attacker must know the exact object key. **This finding is missing from SECURITY_ASSESSMENT (C1).** | **H / P0** (S, in containment) | `app/api/v1/lab-orders/route.ts:117-189`; `lib/storage/index.ts:21-36` |
| ARC-04 / SEC-DEF | Same as SEC-09. | PC | Metadata-only leak. Anon access is probably wider than claimed. | **M / P2** | as SEC-09 |
| ARC-03 / RLS-02 | A receptionist can read clinical notes and prescriptions through PostgREST. | C | Confirmed, and they can also **UPDATE** them. | **H / P1** | `000007:367-517`; `000006:104-130`; `lib/supabase/client.ts:1-6` |
| ARC-07 / RLS-06 | The receiving tenant can rewrite any referral column, and the sender can address any tenant. | C | Confirmed. | **H / P1** (ruling C15) | `000013:168-242`; `features/referrals/schema.ts:12` |
| DB-01 | Child FKs do not enforce `child.tenant_id = parent.tenant_id`. | C | Confirmed. The attacker needs the foreign UUID. | **H / P1** | `000006:15`; `000009:15-16`; `000007:62-63`; `000013:160-161` |
| DB-13 / API-04 | Signed clinical records are mutable, and API PATCH re-signs as the key creator. | PC | Confirmed, except that DELETE is limited to owner and admin. `saveConsultationDraft` has no guard on completed visits. | **H / P1** (an interim API guard can ride in containment) | `app/api/v1/visits/[id]/route.ts:101-188`; `features/consultation/actions.ts:83-104` |
| ARC-10 / WH-01 | Sign-off ignores three update errors, writes to a non-existent `queue_tokens.updated_at`, and sends an incomplete payload. | PC | Confirmed. A failed visit update is still reported as success. `doctor_id` falls back to the signer. | **H / P1** | `features/consultation/actions.ts:610-705`; `000006:42-53` |
| ARC-09 | No transactions anywhere. Orphans are possible. Audit and outbox can be lost. | C | Confirmed. | **H / P1** | `features/billing/actions.ts:80-245`; `features/consultation/actions.ts:640-881`; `lib/webhooks/outbox.ts:73-137` |
| DB-11 / DB-10 | Money is app-only, payment races, and numbering uses the calendar year with an unsafe fallback. | PC | Confirmed. The race comes from `count+1`; the fallback adds gaps and collisions. | **H / P1** | `features/billing/actions.ts:55-245`; `000009:14-82` |
| ARC-14 / WH-02 | No scheduler, inline dispatch, a non-atomic claim, and stuck `processing` rows for both dispatchers. | PC | Confirmed for messaging. The webhook dispatcher has no `processing` state; it just double-delivers on overlap. | **H / P0** (ruling C16) | `lib/messaging/dispatcher.ts:33-149`; `lib/webhooks/dispatcher.ts:57-278` |
| ARC-15 / MSG | Governance is dead code, opt-out is not enforced, and recipient phone numbers go into `audit_logs` metadata. | C | Confirmed. The phone number also appears in dead-letter notifications. | **H / P1** | `lib/messaging/governance.ts`; `lib/messaging/dispatcher.ts:207-254` |
| DB-03 | `ON DELETE CASCADE` from visits wipes prescriptions, invoices and payments. Owners and admins can delete visits. | C | Confirmed (direct API only; no UI path). | **H / P1** | `000006:123-130`; `000007:41-63,401-406`; `000009:15-45` |
| API-15 | Patient export requires only `patients:view`, so a receptionist can export a full medical record. | C | Confirmed. `exports:create` is unused. | **H / P1** | `app/api/v1/patients/[id]/export/route.ts:64-92` |
| API-11 / API-02 | `/api/v1` uses the service role, keys act as admin with no scopes, and keys survive offboarding. | PC | Confirmed. The lab-orders `owner` role is only an audit label. | **H / P1** | `lib/api/auth.ts:8-151`; `000018:5-16` |
| DB-21 / DB-22 | Erasure is a flag only, PII stays in queues and storage, and there is no retention job. | PC | Confirmed. Keeping clinical records is deliberate (statutory). | **H / P1** | `features/dpdp/erasure.ts:26-112`; `000018:169-175` |

### 1.4 UX and frontend (UX_AUDIT.md, FRONTEND_TECHNOLOGY_ASSESSMENT.md)

| ID | Original claim (short) | Verdict | Corrected claim (short) | Final sev / pri | Verifier evidence |
|---|---|---|---|---|---|
| F-01 | Receptionists cannot register patients, and the UI fails with a generic error. | PC | Confirmed. The error message is a clear permission message. The RLS comment shows receptionists were *intended* to create patients. | **H / P0** (PO-3) | `000003:70-77` (comment); `lib/permissions/index.ts:6-8` |
| F-03 | Walk-in and checkout chains are not atomic, so retries duplicate records. | C | Confirmed. There is no idempotency guard. A failed transition only logs a console warning but still shows success. | **H / P1** | `components/queue/walk-in-drawer.tsx:164-200`; `components/queue/checkout-drawer.tsx:233-298` |
| F-04 | The overbook path creates a duplicate patient. | C | Confirmed. | **H / P1** | `components/calendar/booking-drawer.tsx:138-201,500` |
| F-08 | Consultation edits can be lost (15-second debounce, no unload guard), and the upload dropzone does nothing. | C | Confirmed. | **H / P1** | `components/consultation/consultation-workspace.tsx:619-628,1539-1545` |
| UX-3.2 | Consult buttons are shown to all roles, so a receptionist can corrupt visit state. | PC | Only the queue "Start Consultation" button changes state. The dashboard links do not. **New:** `/consultation/[id]` has no permission gate, so receptionists can see clinical data. | **H / P1** | `components/queue/status-actions.tsx:38-129`; `app/(dashboard)/consultation/[id]/page.tsx:29-70` |
| F-02 | The queue is not live. | C | Confirmed. There are no Realtime subscriptions and no polling, and two places promise "real-time". | **H / P1** | `components/queue/queue-view.tsx:88,114-116`; `app/(dashboard)/page.tsx:210` |
| F-05 | Five patient-creation UIs, and only one deduplicates. | C | Confirmed. The server does no dedup, and there is no unique constraint. | **H / P1** | `features/patients/dedup.ts:29`; 5 call sites |
| UX-12 | 29 UTC "today" sites, 56 `toLocale*` calls, no Asia/Kolkata. | PC | The 29 sites are exact, and the dashboard shows yesterday between 00:00 and 05:29 IST. There are about 74 `toLocale*` lines (9 using en-US). Some paths do pin Asia/Kolkata. | **H / P1** | `app/(dashboard)/page.tsx:59-67`; `features/appointments/actions.ts:98,193` |
| UX-3.5 | Money inputs are unsafe, with no `Intl` formatting. | PC | Three of four inputs are clamped at 0 or more. There is no `Intl.NumberFormat`. There are 66 literal `₹` lines. | **M / P2** (absorbed by M4.5) | `components/queue/checkout-drawer.tsx:616-871` |
| F-06 | Staff have no reschedule action. | C | Confirmed. The copilot and the API cannot fill the gap from the UI. | **M / P1** | `components/calendar/calendar-view.tsx:185` |
| F-07 | Patient-record hand-offs drop the patient context. | C | Confirmed. | **M / P1** | `components/patients/patient-detail-view.tsx:150,171` |
| F-10 | Overlays are inaccessible and inconsistent. | PC | About 21 hand-rolled overlays. No focus trap or restore. Duplicate IDs only when overlays stack (not observed). 27 `alert()`/`confirm()` calls. | **H / P1** | `components/ui/modal.tsx:24-75`; drawers |
| F-11 | No route-level loading, error or not-found states. | PC | Confirmed. One cited example (`status-actions`) is a counter-example. | **M / P1** | `find app -name loading.tsx …` = 0 |
| UX-3.11 | A11y WCAG failures. | PC | Most counts reproduce. The unlabelled-input and colour-only claims were not verified. Icon-only buttons are an issue only below the `sm` breakpoint. | **H / P1** | `components/ui/field.tsx:40-43`; `components/ui/dropdown.tsx:44` |
| F-12 | Mobile is not mobile-first. | C | Confirmed (118 small touch targets). | **M / P1** | `components/calendar/doctor-timeline.tsx:220-467`; `components/ui/input.tsx:23` |
| F-09 | No design system in practice. | PC | The `:root` variables are dead, but the `@theme` brand scale **is** used (about 193 times) and bypassed by 937 hex classes. Inter is never loaded. `animate-in` classes do nothing. | **M / P1** | `app/globals.css:3-69`; `app/layout.tsx:1-21` |
| FTA-D2 | Upgrade to the patched current major (Next 16). Zod 4. | PC | The vulnerabilities are real, but a **non-breaking 15.5.x patch** fixes them. Next 16 is an optional modernisation. Zod 4 is tied to the AI SDK major upgrade. | **H / P0** (patch); **P2** (Next 16); **P1** (zod 4 + AI SDK) | `npm audit --json` fixAvailable; `npm view next@15` |
| FTA-perf | The AI drawer ships in every page's JS. No UI tests, no e2e. | PC | Confirmed. There is one static-markup render test. The component sizes are exact (1,681 and 1,029 lines). | **M / P1** (characterisation e2e); **P2** (lazy-load) | `components/layout/app-header.tsx:9,154-157`; `playwright.config.ts:4` |

### 1.5 QA, infrastructure and workflow (TEST_STRATEGY.md, INFRASTRUCTURE_ASSESSMENT.md, GSD_WORKFLOW_ASSESSMENT.md)

| ID | Original claim (short) | Verdict | Corrected claim (short) | Final sev / pri | Verifier evidence |
|---|---|---|---|---|---|
| E-1 / F-1 | Vitest loads `.env` unconditionally, there is no local DB, and tests may hit production. | PC | `.env` only fills unset variables, and a local config exists but is not wired. Production status cannot be verified. | **H (Cr if prod) / P0** | `vitest.config.ts:14`; `supabase/config.toml` |
| E-2 | No test teardown, so orphan users and tenants accumulate. | C | Confirmed. | **H / P1** (**P0 if prod**) | `tests/helpers/tenants.ts:34-518` |
| E-3 | Hard-coded weak password, and signups enabled on the hosted project. | PC | The password is confirmed. The signup evidence is from the *local* config. Exploitability is low (random emails, synthetic tenants). | **L-M / P2** | `tests/helpers/tenants.ts:39` |
| E-4 | RLS tests cover only 8 of 43 tables, and clinical tables have none. | PC | The catalog check covers 8 tables, but **cross-tenant tests exist** for visits, prescriptions, invoices, documents, referrals and API keys. The real gaps: no role-within-tenant DB tests, and no tests for comms, share tokens or API keys. | **H / P1** | `tests/helpers/rls.ts:3-12`; `tests/integration/*.spec.ts` |
| TEST-ES-3 | All safety-critical tests need the DB, and a no-DB run looks green. | PC | Mostly true. Some security tests run without a DB. The run is **not** green (27 files fail, non-zero exit). | **H / P0** (CI DB lane) | `tests/security/ai-rbac.spec.ts`; `vitest.config.ts:14` |
| E-13 / F-2 | No CI/CD. | PC | Confirmed (no `.github/`, no hooks). Vercel's build may catch type errors (hosted configuration not verifiable). | **H / P0** | repo root |
| F-3a | No scheduler, so queued messages are never sent. | PC | No scheduler confirmed. Immediate messages *are* sent inline. Delayed, retried and webhook-retry traffic is lost. | **H / P0**. **Fixed in V2-04 (awaiting PO gate):** pg_cron → pg_net → `/api/jobs/run` every minute (`tests/jobs/scheduler-migration-db.spec.ts`, `tests/jobs/run-route.spec.ts`, `.planning/phases/04-jobs-reliability/evidence/scheduler-local-e2e.json`); staging confirmation pending PO (04-P1, P9) | `lib/messaging/dispatcher.ts:103-110`; `lib/webhooks/outbox.ts:116-129` |
| F-3b | Non-atomic job claim, and stuck `processing` rows. | C | Confirmed. Inline dispatch makes overlap likely. | **H / P0**. **Fixed in V2-04 (awaiting PO gate):** atomic claim with lease and fencing, reaper for expired leases and stuck delivery rows (`tests/jobs/parallel-dispatch-db.spec.ts`, `tests/jobs/reaper-db.spec.ts`, `tests/jobs/delivery-reap-db.spec.ts`) | `lib/messaging/dispatcher.ts:103-149` |
| F-4 | Residency, plan and PITR are unverified. The runbooks contradict each other. No dump job. The drill is open. | PC | Confirmed, except the "KMS vs AES contradiction" (not contradictory). The backup test only greps a document. | **H / P0** (verify before GA) | `docs/ops/backup-restore.md`; `docs/operations/backups.md`; `tests/ops/backup-restore.spec.ts:17-30` |
| G-1 | `allow_default_branch_commits: true`, and no branching strategy. | C | Confirmed. 297 of 298 commits are on `main`. | **H / P0** (process gate before the first GSD execute; the verifier suggested P1) | `.planning/config.json`; `git rev-list` |
| W-02 | No Claude Code deny rules for `.env`. | C | Confirmed at project and user level. | **H / P0** (process gate) | `ls .claude`; `~/.claude/settings.json` |
| F-6 | 10 production vulnerabilities, and no Dependabot. | C | Confirmed. Duplicate of SEC-24. | **H / P0-P1** (as SEC-24) | npm audit |
| F-7 | An unused org-level `SUPABASE_ACCESS_TOKEN` sits in the app `.env`. | PC | Present and unused by the app, but deliberately templated for the CLI. Its scope is the whole **account**, which is broader than org-level. | **M-H / P1** | `.env.example:7`; `package.json:51` |
| F-8 | The in-memory rate limiter leaves `/api/v1` and OTP unlimited. | PC | It is per-instance, not unlimited, and applies only after API-key auth. **The OTP part is refuted**: OTP goes through Supabase Auth. There is no app throttle on `requestOtpAction`. | **M / P2** (limiter); **P1** (OTP throttle and confirming Supabase Auth limits) | `lib/api/rate-limiter.ts:12-48`; `features/auth/dev-actions.ts` |
| F-5 | No error tracking, alerting or log retention. 191 `console.*` calls. | PC | Confirmed. A static `/api/health` exists. Log retention is set by the host. CERT-In requirements are regulatory context. | **H / P1** | `app/api/health/route.ts`; `lib/messaging/dispatcher.ts:234-240` |
| E-6 | Production code branches on test environment variables. | C | Confirmed, plus an SSRF DNS bypass for test domains. Production is unaffected unless the environment is misconfigured. | **M / P2** | `lib/webhooks/ssrf.ts:103-135`; `lib/ai/soap-generator.ts:302-318` |
| E-5 | Tests give false confidence. | PC | Copied logic and mock-only isolation tests confirmed. The backup spec also touches the DB. Real RLS tests exist (for 8 tables). | **M / P1** | `tests/cabin/navigation-roles.spec.ts:5-56` |
| E-8 / E-7 | No e2e, a11y, visual or coverage tests, and tests are excluded from type-checking. | C | Confirmed. | **H / P1** | `playwright.config.ts:4`; `tsconfig.json:26` |
| E-12 / G-4 | Phase verification counts are hand-typed and wrong, a single free-model reviewer, and contradictory planning state. | C | Confirmed through git history (17 tests, not 37; 15, not 14). | **M / P2** for the record. The process rule "CI evidence only" is enforced at every gate. | `06-VERIFICATION.md:261,264`; `06-REVIEWS.md:7` |

---

## 2. Refuted sub-claims (dropped from the roadmap)

No whole claim was refuted. The parts below were disproved, so the roadmap does not rely on them.

| Source | Refuted statement | Evidence |
|---|---|---|
| SEC-09 / ARC-04 | "Duplicate GST invoice numbers are stored under concurrency" | `UNIQUE(tenant_id, invoice_number)` (`000009:25`). The insert fails instead. |
| SEC-05 / ARC-05 | "Invoice PDFs are disclosed cross-tenant" | The storage path and generator are scoped to the token's tenant (`features/billing/pdf/generator.ts:140-147`) |
| ARC-02 | "A member can move `tenant_id` to any tenant" | `WITH CHECK` requires the new tenant to be in the user's own tenants (`000011`) |
| SEC-25 | "Seed scripts create real auth users and tenants" | The seed scripts upsert reference catalogs only (`scripts/seed-*.ts`) |
| SEC-15 | "The webhook forces the dev provider for replies" | It is conditional on the inbound provider (`route.ts:331`) |
| SEC-13 | "Tokens leak through Referer on modern browsers" | Browser defaults and `rel=noreferrer` prevent it (`app/r/[token]/page.tsx:285`) |
| SEC-14 | "Any UAT or preview deployment is exposed" | Vercel and `next start` force `NODE_ENV=production` |
| D10 / ARC-10 | "`doctor_id` is undefined" | It falls back to `session.userId` (`features/consultation/actions.ts:701`) |
| D15 | "All AI silently falls back to a mock" | The copilot routes use the `test-api-key` literal and fail (`lib/ai/client.ts:43-49`) |
| F-3a / F5 | "Queued messages are never sent" | Immediate sends dispatch inline (`lib/messaging/dispatcher.ts:103-109`) |
| F-8 | "OTP endpoints use the in-memory limiter" | OTP goes through Supabase Auth |
| E-3 | "Signups are enabled on the hosted project (`config.toml`)" | `config.toml` configures only the local CLI stack |
| E-4 | "Clinical tables have no cross-tenant tests" | `tests/integration/visits.spec.ts:167+`, `per-visit-billing.spec.ts:171+`, etc. |
| TEST-ES-3 | "A no-DB run reports green" | 27 files fail, and the exit code is non-zero |
| F-4 | "The KMS and AES runbooks contradict each other" | AES-256 with KMS-managed keys is consistent |
| F-11 | "`status-actions` swallows errors" | It renders them inline (`components/queue/status-actions.tsx:19-67`) |
| E-5 | "The backup test only greps a doc" | It also inserts and queries through the admin client |
| ARC-14 | "The webhook dispatcher leaves stuck `processing` rows" | It has no `processing` state |

## 3. Claims needing hosted-environment access (outstanding investigations)

The verifiers could not settle these points statically. They are tracked as decisions and investigations in roadmap §1.2 and §13.

| # | Question | Raised by |
|---|---|---|
| OI-1 | Is the Supabase project in `.env` production? Does it hold real patient data? Is v1 live? | SEC-25, E-1, E-2, F-4 |
| OI-2 | What are the project's region, plan tier and PITR status? | F-4, I-01 |
| OI-3 | Is any external or dashboard cron calling `/api/cron/*`? Is `CRON_SECRET` set? (V2-04: the `/api/cron/*` routes are deleted and answer 404; `CRON_SECRET` stays for the diag route, R-27. Answer pending PO, 04-P9.) | F5, F-3a |
| OI-4 | Does the hosted schema drift from `supabase/migrations`? Does an `auth.users` row with the nil UUID exist? | F7, BACKEND B1 |
| OI-5 | Do Supabase default privileges give `anon` EXECUTE on the SECURITY DEFINER functions? | SEC-09 |
| OI-6 | Does the production build expose server-only-imported or unimported actions (`getPatient`, `getPatients`, `notifyPrescriptionIssued`)? Answer with a production build's server-reference manifest, not a dev build. | ARC-01, D4, SEC-01 (C31) |
| OI-7 | What are the Supabase Auth OTP/email rate limits and session settings on the hosted project? | F-8, SEC-26 |
| OI-8 | Is HSTS added at the edge? What is the host's log retention? | SEC-13, F-5 |
| OI-9 | Do DPAs exist with the AI and messaging providers? Which `AI_PROVIDER` and `MESSAGING_PROVIDER` does production use? | SEC-16, D15 |
| OI-10 | Is there any evidence of past exploitation (API, Vercel or Supabase logs)? | SEC-01/03/04/05 |

---

## 4. Cross-document contradictions and how the roadmap resolves them

Source: the consistency review. "Roadmap ref" points to `V2_MASTER_ROADMAP.md`.

| # | Contradiction | Resolution (decision) | Roadmap ref |
|---|---|---|---|
| C1 | SECURITY says `/api/v1` has no tenant gap, while ARC, API and Backend report the lab-orders `storage_path` issue | The ARC finding is verified (ARC-06). It is added to the security P0 containment batch as **P0-05**. SECURITY_ASSESSMENT §3 needs an erratum. | §7, §10 P0-05 |
| C2 | SEC-04 is Critical in SECURITY, but API rates it P1 and Backend Phase A omits it | **Critical / P0.** The verifier confirmed the `dev` provider bypass has no environment gate. API_ASSESSMENT §4 is wrong. Containment includes it as **P0-03**. | §7, §10 |
| C3 | The documents count 3, 4 or "admin + 3" service-role factories | There are **5** (`lib/supabase/admin.ts`, `features/appointments/actions.ts`, `features/auth/dev-actions.ts`, `lib/messaging/dispatcher.ts`, `lib/storage/supabase-provider.ts`). The single-factory work item covers all five. | §6 |
| C4 | 13 vs 29 UTC "today" sites | **29** (verified). | §4 |
| C5 | 6 vs 8 SECURITY DEFINER functions | **8**. | §3 |
| C6 | 13, 14 or 15 v1 route files; 28 or 29 `route.ts` | **15** route files under `app/api/v1` (13 data routes); **28** `route.ts` in total. | §3 |
| C7 | 43 vs 44 tables | **43** distinct tables (`prescriptions` is created twice). | §3 |
| C8 | "About 230 exported functions" | Not supported. Use 137 `export async function` in `features/` (198 including `app/`). | §3 |
| C9 | Dependency upgrade priority and size disagree (P0 S-M vs P1 M) | **Split.** next/postcss 15.5.x patch is **P0, S**. zod 4 + AI SDK major is **P1, M-L**, with its own regression gate. | §10 P0-06, P1-19 |
| C10 | No document mentions the AI SDK vulnerabilities | Added to SEC-24's corrected claim and to **P1-19**. | §7 |
| C11 | Share-token fix is P0 (SEC) vs P1 (ARC/DB). Backend A3 covers only 2 routes | **P0**, covering all six token routes plus the `FOR ALL` policy and creation through an RPC. | §10 P0-04 |
| C12 | Three sizes for the override removal (S, M, L) and two for the membership guard | Override removal is **M**. Membership guard is **S-M**. "≤ 1 day-ish" is removed (no day estimates). | §14 |
| C13 | Role-aware RLS is P0 (PRODUCT F4) vs P1 (SEC, ARC, DB) | **P1**, scheduled first in the data-authorisation phase (V2-05). Rationale: insider-only, same tenant; size L; depends on the PO role matrix. Interim exposure is accepted explicitly by the PO at G1. | §10.2 |
| C14 | Audit forgery and notification visibility are P2 (ARC, DB) vs grouped under High SEC-06 | **P1**, aligned with SECURITY. | §10 P1-01, P1-04 |
| C15 | Referrals: SEC-33 P2 vs remediation, ARC and DB P1 | **P1** (ARC-07 verified High). | §10 P1-10 |
| C16 | CI and scheduler/atomic claim are P0 (INFRA) vs P1 (ADR, Backend) | **P0**. Duplicate sends and lost retries are live defects, and CI is a prerequisite for evidence-based gates. | §10 P0-11, P0-12 |
| C17 | Local test DB P0 (TEST, INFRA) vs P1 (SEC P1-13). This creates a circular P0 exit criterion | **P0** (P0-10). The SEC P0 exit criterion is reworded to "tests on a local stack *or* a manual verification script on the hotfix branch". | §10, §11 |
| C18 | Atomic writes via Kysely transactions (ADR-003) vs named plpgsql RPCs (UX, Frontend) | **Decided (revised after review): RPC-per-flow is the default.** The 8 atomic commands are plpgsql functions, `SECURITY INVOKER` under RLS, called through supabase-js. Kysely + `DATABASE_URL` + `withTenantTx` is demoted to "revisit only if RPCs prove unmaintainable" (no new privileged secret, no pooler constraints, no second data layer). ADR-003 is superseded and ADR-011 amended accordingly. The frontend still depends only on the "atomic server command" interface. A short D1 *confirmation* spike runs in **V2-03** (before V2-05), proving one flow end to end: RLS, `auth.uid()` actor, audit and outbox in the same transaction. Both documents now say the same thing. | §6, §10, §12 V2-03 |
| C19 | Two role-aware RLS designs (`role_permissions` + `has_permission()` vs `current_user_role()` + generated policies) | **`has_permission(tenant, perm)`** as a STABLE SQL function with a hard-coded `CASE` over the 5 fixed roles (revised after review; simpler than a `role_permissions` table + join + codegen). A unit test asserts parity with `lib/permissions/matrix.ts`; pgTAP covers the policies. A table is introduced only if per-tenant custom roles are ever approved. ADR-006 is amended. | §6 |
| C20 | Four different service-role allow-lists. The Semgrep rule allows what ADR-011 removes | **ADR-005's list** is canonical. It is enforced by **one** mechanism, ESLint `no-restricted-imports` (P1-34); the Semgrep rule in SECURITY_VERIFICATION is dropped rather than maintained in parallel. `/api/v1` moves under RLS (ADR-011). | §6 |
| C21 | Rate-limiter store: Postgres (ADR-010) vs Upstash/KV first (SEC) | **Postgres** by default (no new vendor). Public token routes are limited inside the route handler through an RPC, not in middleware. Upstash is used only if load tests show a need. | §6, §9 |
| C22 | Scheduler: pg_cron + pg_net vs Vercel Cron | **pg_cron + pg_net** by default. It is defined in a migration, so it is visible in the repo and independent of the Vercel plan. pg_cron + pg_net is the only scheduler (roadmap §9, C45). | §6, §9, PO-6 |
| C23 | Storage: Supabase only (ADR-014) vs "reuse labs S3" and an S3 backup bucket | **ADR-014**: clinical documents live in Supabase Storage only. The backup bucket (India region) is a separate infrastructure decision at G2. | §9 |
| C24 | Next.js target: 16 vs latest 15.x vs either | **Patch to the latest 15.5.x now (P0).** Next 16 is evaluated as a separate P2 PR in V2-03, before M2 component work starts. | §5 |
| C25 | Money stored as integer paise (frontend) vs `NUMERIC(10,2)` rupees (schema) | **Keep `NUMERIC(10,2)` in the DB for v2.0.** `lib/money` parses and formats exactly (decimal-safe) at the boundary. No paise migration without a new ADR. FRONTEND PR-9 is amended accordingly. | §5, §6 |
| C26 | New Mumbai production project (INFRA) vs reconciling the existing project (Backend B1) | **Resolved 2026-11-10 by PO-1 (test DB, no real data; new instance at go-live) → new production project.** Original decision tree: No real data: create a new Mumbai project and retire the current one. Real data: keep it, run B1 baseline reconciliation, and plan a region migration only if residency requires it. | §1.2 PO-1, §9 |
| C27 | Doctor and receptionist billing access differ across the test plan, the IA and the code | **PO decision PO-3** (role matrix) before TEST journey 8, the SECURITY_VERIFICATION matrix, IA §3.2 and FRONTEND PR-4 are finalised. | §1.2 |
| C28 | Conflicting retention periods (comms 90 days vs 12 months; billing 6 vs 8 years; logs 180 days vs ≥ 1 year; backups) | **DATA_HANDLING §5 is the single schedule**, pending counsel. Logs: 180 days in India for CERT-In **and** ≥ 1 year for audit logs (both apply). | §7 |
| C29 | The legal basis for clinical retention differs (NMC 3 years vs IMC 2002) | Use the DATA_HANDLING/SECURITY framing (IMC 2002 reg. 1.3.1, state rules; ⚖ counsel). DATABASE §7 needs an erratum. | §7 |
| C30 | Five incompatible phase schemes. GSD's "Phase 0 = foundations" would delay the hotfix | **Security containment first.** Every scheme is mapped onto prompt §12 Phases 0–6 in roadmap §11. Security remediation is deliberately pulled forward from prompt Phase 5. | §11, §12 |

| C31 | SEC-01 (VERIFICATION_LOG §1.1 and roadmap) said "six browser-reachable actions", while ARC-01 in the same log said `getPatient`/`getPatients` exposure was not verified | **4 confirmed browser-reachable** (`searchPatients`, `updateClinicSettings`, `updateStatutorySettings`, `toggleGlobalConsent`); `getPatient`/`getPatients` pending OI-6. SEC-01 verdict changed to PC. Severity stays **Critical / P0**. Raised by the independent roadmap review. | §1.1, §7 |
| C32 | Roadmap §15.6 required all 10 e2e journeys at both viewports, but TEST_STRATEGY T-14 (journeys 2, 3, 5, 7, 10) is P2 | **T-14 raised to P1** as backlog item P1-42 (V2-08 to V2-11, each journey with its workflow). §15.6 stands. TEST_STRATEGY T-14 receives an erratum. | §10 P1-42, §15 |

Missing content noted by the consistency review: TARGET_ARCHITECTURE has no §10 rows for frontend, design system, testing or security tooling; the roadmap §5, §8 and §6 cover these. SECURITY findings SEC-08 to SEC-33 lack the Component, Impact and Verification fields. UX has only ASCII wireframes and no design-skill exercise. The documentation items are recorded as debt (roadmap §10, P2-DOC). The design gap is now closed by phase V2-DX and the design sub-gate G2-D before any primitives are built (revised after review). None of these blocks G1.

**Erratum (V2-04, 2026-11-14): staging backup target.** The roadmap's V2-04 dependencies, expected changes and
acceptance named an AWS `ap-south-1` bucket written by AWS CodeBuild. Staging backups instead go to a **Cloudflare R2**
bucket, written by the GitHub Actions workflow `.github/workflows/backup.yml` in the GitHub Environment
`staging-backup` (PO decision B-3, 2026-11-13, `.planning/PO-ACTIONS.md`; ruling R-48). The AWS `ap-south-1` design
moves to the production backups (V2-15). Applied in `V2_MASTER_ROADMAP.md` §12 V2-04 by 04-07c (`838d4bd`).

---

## 5. Methodology

1. **Static review.** 20 specialist assessment documents were produced by reading the code, migrations, configuration and planning artifacts on `feature/v2` (read-only).
2. **Isolated test run (coordinator).** Vitest was run with every external service pointed at dead endpoints: 69 files; 442 passed, 206 skipped, and 27 files failed only because they need the hosted DB. `tsc --noEmit` passes. `eslint` errors come almost entirely from tooling directories. `npm audit --omit=dev` was run read-only.
3. **Independent verification.** 91 high-impact claims were each re-derived by a separate verifier agent. The verifier had only the claim and the repo, not the author's reasoning. It used grep, file reads, `git log` and npm metadata, and gave a verdict, a corrected claim and a suggested severity.
4. **Consistency review.** A further agent cross-checked all documents for contradictions in facts, counts, priorities and designs, and spot-checked against the code (§4).
5. **Adjudication.** The roadmap author (the "Principal Architect" role) set the final severity and priority, recorded in this log and in the roadmap, and changed some verifier suggestions (for example F4 P0→P1 and G-1 P1→P0). **Because the adjudicator is part of the authoring pipeline, this is not an independent review** under prompt §13. An independent review of the roadmap and these rulings, by a reviewer outside the authoring pipeline, plus PO approval, is still required at G1.
6. **Independent roadmap review (2026-11-10).** A separate reviewer critiqued the roadmap and this log. Its findings and how each was handled are in the Review disposition appendix. This review does not replace the G1 review (it saw only the documents, not the PO answers).

**Not verified (out of scope or unsafe in discovery):**
- **Hosted database state:** data content, schema drift, grants, Auth settings, logs. Reason: no connection to Supabase was permitted.
- **Deployment and hosting configuration:** Vercel project, environment variables, cron, region, edge headers, log retention.
- **Visual and interactive walkthrough:** no running app was exercised with real sessions. UX findings come from code. Screenshots and axe runs are deferred to M0.
- **DAST and penetration testing:** no dynamic scans, no exploit attempts against any environment. Exploitability is inferred from code paths only.
- **The DB-backed test suites (27 files):** not run. They write to the hosted project.
- **Legal conclusions (⚖):** DPDP, CERT-In, IMC/NMC and GST retention are stated as regulatory context pending counsel.
- **MSG91 template approval, provider DPAs and AI provider retention terms:** contractual questions.

No secret values were read or printed. No patient data was accessed.

---

## Appendix: Review disposition (independent roadmap review, 2026-11-10)

An independent reviewer critiqued `V2_MASTER_ROADMAP.md` and this log. Its factual claims were re-checked read-only against the code and the detailed documents before any change was made. "Accepted" means the change is in the roadmap and/or this log.

**Spot-checks of the reviewer's code claims**
- `getPatients` has no importer in `app/`, `components/`, `features/` or `lib/`. `getPatient` is imported only by `app/(dashboard)/patients/[id]/page.tsx:2` (a server component). `searchPatients` has 5 client importers and `.limit(25)` (`features/patients/actions.ts:264`). **Confirmed.**
- 20 files contain `sessionOverride`. 16 start with `"use server"`; the other 4 are `features/{billing,prescriptions,referrals}/pdf/generator.ts` and `features/dpdp/export.ts`. **Confirmed.**
- `listWebhookSubscriptions` selects `signing_secret` and returns it as `signingSecret` (`features/webhooks/actions.ts:35,48`); create returns it too (`:107`). **Confirmed** (WH-04).
- TEST_STRATEGY T-14 is P2 (`TEST_STRATEGY.md:299`). DB-08, DB-09 and DB-23 exist in DATABASE_ASSESSMENT; ARC-19 and ARC-22 in ARCHITECTURE_ASSESSMENT; UX-15 and UX-16 (both P2) in UX_AUDIT. **Confirmed.**

**Required changes**

| # | Item | Disposition |
|---|---|---|
| R1 | SEC-01 overstates browser reachability | **Accepted.** SEC-01 verdict changed to PC (tally now 40 C / 51 PC); 4 confirmed actions named; `getPatient`/`getPatients` pending OI-6; "`getPatients` has no row limit" dropped and replaced with the `searchPatients` 25-row/arbitrary-query note. Added C31. Severity stays Cr/P0. Roadmap §1.1 and §7 updated. |
| R2 | 17 vs 16 action modules | **Accepted.** F1/D1, ARC-01 and roadmap §3 and §14 say 16, and name the 4 other files. |
| R3 | Local DB harness after the override removal | **Accepted.** New phase **V2-01a** (P0-10) precedes V2-01; P0-10 no longer depends on P0-01; V2-01 depends on V2-01a and must pass the existing suites before and after. |
| R4 | G0/V2-00 ordering contradiction | **Accepted.** Order is G1 → V2-00 → G0 → G2 in the §11 diagram, the §13 critical path and the V2-00 dependencies. |
| R5 | Design approval after design implementation | **Accepted.** New phase **V2-DX** (prompt Phase 2) and sub-gate **G2-D** before plan 06-02; V2-06 and V2-08 depend on G2-D (V2-08 through V2-06). Prototype work removed from V2-06. |
| R6 | D1 spike timing vs ADR ratification | **Accepted, combined with R7.** The spike becomes a *confirmation* spike in V2-03 (plan 03-07), before V2-05. G2 records ADR-003 as superseded, ADR-006/011 as amended, and the RPC pattern as "Proposed, pending the D1 spike". Log C18 and roadmap §6 now agree. |
| R7 | Kysely + `DATABASE_URL` not justified | **Accepted.** RPC-per-flow (plpgsql, `SECURITY INVOKER` under RLS) is the decided default; Kysely is "revisit only by new ADR". ADR-011 amended to `api_authenticate()` + explicit RPCs or a short-lived principal JWT (the JWT option needs the JWT signing secret, so it is chosen at G2 only if simpler). R7 rewritten. The ARCHITECTURE_DECISIONS erratum is in P2-DOC. |
| R8 | Staging used before it exists | **Accepted.** P1-35 split: P1-35a staging in V2-03 (plan 03-08); P1-35b production in V2-15 (or earlier per PO-15). V2-04 depends on 03-08. |
| R9 | Deployment model undefined | **Accepted.** PO-15 added with both paths stated in §11; R16 added. |
| R10 | Backups verified too late | **Accepted.** P0-16 split: P0-16a (verify or test-restored dump) before any hosted migration, in S0 or V2-00; it is in the G-HF and G0 evidence, and V2-05 and V2-13 depend on it. P0-16b (runbooks + drill) stays in V2-15. |
| R11 | Conditional key rotation | **Accepted.** P0-07 is unconditional, scheduled in V2-00 and S0; labelled Risk / Assumption (validate); R15 added. |
| R12 | Phases missing §11 task fields; V2-09 too large | **Accepted.** Every phase now has objective, scope, dependencies, expected changes, plans, acceptance, tests and evidence. V2-09 split into V2-09a (immutability + amendment, DB), V2-09b (consult workspace + save model), V2-09c (Rx builder + PDF). |
| R13 | Backlog items with no phase | **Accepted.** A Phase column now covers every P0–P2 item. P2-08 split: k6, Lighthouse and coverage became **P1-41** (V2-02/V2-14/V2-15); indexes stay P2-08 (V2-05/V2-08). P2-03 → V2-03; P2-04 → V2-00; P1-24 relabel → V2-11. |
| R14 | V2-05 dependencies incomplete | **Accepted.** V2-05 depends on V2-03 plans 03-03 and 03-07 and on P0-16a; the critical path is updated. P1-02 depends on the B1 baseline. |
| R15 | Detailed findings dropped from the backlog | **Accepted with one priority change.** DB-08 → P1-39; DB-09 → P1-40; ARC-22 folded into P1-19; WH-04 → P2-09; UX-15 → P2-10; DB-23 → P2-11. ARC-19 → **P1-43 (P1, S)** as the reviewer proposed, although ARCHITECTURE_ASSESSMENT rates it P2: C23 already decides the removal, and it shrinks the service-role signing surface involved in ARC-06. |
| R16 | G1 review called "completed" though not independent | **Accepted.** G1 now reads "Pending: independent review … outside the authoring pipeline". §5 and the "How to read" note state that the rulings were adjudicated by the roadmap author. |
| R17 | §15.6 vs TEST_STRATEGY T-14 | **Accepted.** T-14 raised to P1 as **P1-42**, delivered per workflow phase; §15.6 kept; C32 added. TEST_STRATEGY erratum in P2-DOC. |
| R18 | PO decision gaps | **Accepted.** PO-16 (API/webhook consumers; disable `/api/v1` if none), PO-17 (budget, with a cost-scoped pen-test option), PO-18 (team capacity) added; the error-tracking sub-processor question is added to PO-12. |
| R19 | Proposals not marked | **Accepted.** The 30-day restore-drill window (§16 G6, §17) and the 90-day deprecation (R14) are marked Assumption (validate), confirm at G2. |

**Optional improvements**

| # | Item | Disposition |
|---|---|---|
| O1 | Simplify ADR-006 | **Accepted.** `has_permission()` with a hard-coded `CASE` over 5 roles + a parity unit test; no `role_permissions` table unless custom roles are approved (C19). |
| O2 | One boundary mechanism | **Accepted.** ESLint `no-restricted-imports` only; the Semgrep rule is dropped (C20). |
| O3 | Consolidate phases; lighter gates | **Partly accepted.** G4 is now a light per-PR check, and full gates are G1, G2/G2-D, G3, G5 and G6. **Not merged:** V2-03 + V2-04 and folding V2-11. V2-03 is already M-L after taking staging, logging and the spike. V2-04 changes production messaging behaviour and has its own staging drill. V2-11 holds the v1 UI deletion. Merging would recreate the large phases that R12 asked to split. Revisit at G2 if PO-18 confirms a single engineer. |
| O4 | Error tracking + logger early | **Accepted.** P1-25 error tracking, logger and request IDs in V2-03; alerts in V2-04; drain in V2-15. |
| O5 | V2-01 needs only G1 + ADR-005 | **Accepted.** V2-01a/V2-01 need G0 + ADR-005 ratified, not all of G2. |
| O6 | Interim API PATCH guard in containment | **Accepted.** In S0 and V2-01 scope and acceptance. |
| O7 | Next 16 decision before 06-02 | **Accepted.** V2-06 depends on V2-03 plan 03-06. |
| O8 | ARC-06 in §1.1 | **Accepted.** §1.1 now lists five defects. |
| O9 | UX-16 to P2 | **Accepted.** P2-12 in V2-09c. |
| O10 | Mark unverified counts | **Accepted.** `as any`, eslint-disable and missing-type counts are marked unverified in §3. |
| O11 | Cost-scoped pen test | **Accepted.** In the PO-17 default, V2-14 and §17. |
| O12 | Unambiguous PO-3 default | **Accepted.** Doctors may view invoices for their own visits and use Sign & Bill; no collect, paid-invoice edit or refund. |

**Rejected or not applied:** none of the reviewer's factual claims was found to be incorrect. The only deviations from what the reviewer proposed are the partial adoption of O3 (reason above) and P1, not P2, for ARC-19 (as the reviewer proposed; noted because it differs from the source document).

**Source-document notes.** Every PARTIALLY_CONFIRMED finding (51) now has a one-line `> Verification (2026-11-10): …` note in its source document under `docs/v2/`, 61 notes in total because some findings appear in two documents (for example ARC-02/RLS-01). Findings in a heading section get the note directly under the heading. Findings in table rows get the note directly below the table, because a blockquote inside a Markdown table would break it. No finding was REFUTED as a whole, so there are no REFUTED notes; refuted sub-claims are covered in the PARTIALLY_CONFIRMED notes. `prompt.md` was not edited.


## Addendum: product-owner answers (2026-11-10)

- **PO-1:** v1 is not deployed with real clinic or patient data. The Supabase project in `.env` is used only as a test database, and go-live will use a new Supabase instance.
- **Effect:** the S0 v1 hotfix, gate G-HF, P0-08 forensics and the DPDP/CERT-In breach assessment are not required. C26 is resolved: create a new production project. R1 is closed and R2 is downgraded. The SEC-25 risk becomes "tests pollute the shared test project", not "tests write to production". Severity ratings of the code-level findings are **unchanged**: they describe the code that would ship.

## PO decisions addendum 2 (2026-11-10)

**Source.** The PO's written answers of 2026-11-10 to PO-3 to PO-18, plus five new requirements: AI gating, subscriptions and an admin portal, password authentication, a team of PO + Claude only, and an installable PWA. Four new design documents were written and independently reviewed: [SUBSCRIPTIONS_AND_PLANS](SUBSCRIPTIONS_AND_PLANS.md), [AI_STRATEGY](AI_STRATEGY.md), [AUTH_REDESIGN](AUTH_REDESIGN.md) and [PWA_STRATEGY](PWA_STRATEGY.md). Each one records its review disposition at the end. The roadmap's §1.2 has the verbatim answers and their consequences.

**Answers recorded.**

| PO item | Answer | Roadmap effect |
|---|---|---|
| PO-3 | Receptionists register patients | P0-14 implements it (V2-05, V2-08); journey 8 is final |
| PO-4 | Cancel, void, refund + Indian-FY numbering accepted | P1-06 scope fixed |
| PO-5 | Labs stay document upload; structured labs v2.1 | P1-24 relabel (S); P2-13 (v2.1) |
| PO-6/7 | Keep Vercel + Supabase | Defaults: Vercel Pro `bom1`; Supabase Pro `ap-south-1`; PITR 7 days; RPO ≤ 2 min; RTO ≤ 4 h (to confirm) |
| PO-8 | Appointment reminders only; vaccines v2.1 | P1-14 narrowed; AI-25 (v2.1) |
| PO-9 | Delegated; decided per AI_STRATEGY | P1-16 and P1-22 superseded by AI-01/03/04/05 |
| PO-10 | Claude reviews everything; no human | Isolated Claude reviewer agents at every gate; R13 rewritten |
| PO-11 | Claude Code only; GSD install | P1-36: GSD for Claude Code in V2-00; `.agents/` and `.opencode/` retired |
| PO-12 | No counsel; data stored in India | ⚖ items become PO-accepted defaults; R22 added |
| PO-14 | Delete leftover test users | Done 2026-11-10 by the coordinator, on the PO's go-ahead; R2 reduced. This roadmap revision did not re-verify the deletion. |
| PO-15 | No incremental rollout; go-live after all of v2 | Rollout flags, dual paths and soak periods removed (§11); R16 closed |
| PO-18 | Team = PO + Claude | Phases run one after another; R21 (bus factor) added |
| Open | PO-13, PO-16, PO-17 | Defaults kept |
| New | PO-19 to PO-23 | Brand and domain; merchant/GST facts; AI pricing and trial; AI clinical content and privacy; accepted deviations |

**Contradictions between the new documents, resolved in the roadmap (§10.3).**

| # | Topic | Ruling |
|---|---|---|
| C33 | AI pricing: `ai_pro` plan (AI D-1) vs second subscription (SUB-D8) | Second subscription `ai_assist`, because Razorpay UPI/eMandate subscriptions cannot be updated (SUB [S25], [S26]). The price and quota from AI D-1 are kept. **Superseded by C41 (round 2): no AI is sold in v2.0.** |
| C34 | Trial AI quota: 100 drafts (SUB) vs paid quota (AI D-2) | Paid quota, per the PO's "no restrictions at all". **Superseded by C41 (round 2): no AI is sold in v2.0.** |
| C35 | Feature-key names | AI_STRATEGY §6.2 owns them |
| C36 | Phase names: V2-10b/V2-11b (AUTH, PWA) vs V2-13b/V2-13c (SUB) | V2-13b and V2-13c, for dependency order |
| C37 | AI-05 scribe placed in V2-09b, but the gateway is in V2-12 | AI-05 moves to V2-12 |
| C38 | AUTH open question about the signup mandate | Closed by SUB R4: the mandate is required before the trial |

**Backlog items superseded.** P0-15 → AUTH-06; P1-09 → AUTH-05; P1-16 → AI-03/04/05; P1-22 → AI-01; P2-07 → AUTH-08/09; P2-12 → AI-11. P1-15 and P1-26 lose their OTP clauses. P2-02 loses the lazy-loaded AI drawer.

**New phases.** V2-13b (SaaS subscriptions & billing) and V2-13c (Platform admin & tenant data lifecycle) are new, which makes 22 phases. V2-05, V2-06 and V2-12 are renamed to reflect entitlements, the PWA shell and AI.

**External facts checked for this revision** (accessed 2026-11-10):
- Supabase PITR: worst-case RPO is two minutes. Retention of 7, 14 or 28 days costs about US$100, US$200 or US$400 a month. Pro keeps 7 daily backups without PITR. Source: https://supabase.com/docs/guides/platform/backups
- Vercel Hobby is for "personal, non-commercial use"; Pro costs US$20 per seat per month. Source: https://vercel.com/pricing
- The Supabase Pro base price was **not re-checked**.
- Facts specific to the new documents are cited and marked Unconfirmed in those documents.

**Errata applied (dated "Update (2026-11-10, PO decisions)" blockquotes):**
- PRODUCT_BASELINE: §3 role matrix and §4.1 auth flow.
- INFORMATION_ARCHITECTURE: §3.3 new surfaces.
- DESIGN_SYSTEM: §4.6 PWA icon, theme and AI vs Smart Assist labels; §6.9 no-PHI-on-device copy.
- GSD_WORKFLOW_ASSESSMENT: §5.5 Claude-only reviewers.
- INFRASTRUCTURE_ASSESSMENT: §4.5 email, payment webhooks and lifecycle cron.
- DATA_HANDLING: §4 processors and §5 archive/purge lifecycle and AI metadata.
- TEST_STRATEGY: journey 1.
- Reconciliation notes at the top of SUBSCRIPTIONS_AND_PLANS, AI_STRATEGY, AUTH_REDESIGN §9 and PWA_STRATEGY §10.

**Final independent review (2026-11-10): disposition.** An isolated reviewer agent returned "not ready for G1: 16 required fixes". Each claim was checked against the documents before editing. **None was rejected as incorrect.** All 16 required fixes and all 11 optional improvements were applied, with these choices and adjustments:
- **#1 India-only processing (C39):** an India-resident error sink was chosen (`ops.error_events` in the Mumbai project, plus the India log drain from V2-15). No error-tracking vendor outside India. PO-23(h) lists Turnstile, HIBP, Google abuse-monitoring logs, WhatsApp transit through Meta, Vercel runtime logs (storage location Unconfirmed), and GitHub/Claude Code (synthetic data only). The reviewer's list was extended with WhatsApp/Meta, which DATA_HANDLING:81 already records.
- **#2 Plans & prices UI (C40):** the preferred option was applied. A minimal screen joins SUB-09 (M +S) with a V2-13c acceptance line. SUB §9.3 and §13 are updated.
- **#3–#5:** the bodies of SUB and AI_STRATEGY are rewritten: the trial quota equals the `ai_assist` quota; the §6.2 keys are copied into SUB §7.3; `ai.scribe` (boolean) and `ai.scribe.monthly_drafts` (limit) are separate keys; `entitlement_keys`/`plan_entitlements` replace `features`/`plan_features`; the add-on lifecycle rows replace the `ai_pro` rows; D-1 and AI-18 now describe the add-on.
- **#6 adjusted:** the reviewer wrote "V2-12 (plan 12-05)". Because fix #11(e) moves rate limiting to 12-04, the scribe is now **plan 12-06**, and every document uses 12-06.
- **#7–#10:** applied in AUTH (phase names, the sequential phase order, `/onboarding/clinic` and `/onboarding/billing`), SUB §10.1 (`app/api/webhooks/razorpay/route.ts`) and PWA (`/billing/locked` and `/billing/locked/staff`; idle local sign-out replaces the lock overlay; R14 rewritten).
- **#11(a)–(f):** applied. AUTH-04b ships the server-side `POST /auth/signout`, and PWA-02 wraps it. PWA-02 ships only the `/sw.js` headers, and P1-18 carries `worker-src`/`manifest-src`. AI-06 is split into L1 (V2-02), L2 (V2-05 database part, V2-12 gateway part) and L3 (V2-12). AUTH-08 dependencies are split by side. V2-12 plans are renumbered. P1-37 now depends on AUTH-05.
- **#12–#14:** applied. A §11 note now says that tenants exist only through seeds and `comp_until` between V2-01 and V2-13b.
- **#15:** phases were re-sized instead of split (V2-01 L; V2-05, V2-12 and V2-13b XL), and splits into 05a/05b and 12a/12b are allowed at plan time. Phase count (22) and order are unchanged.
- **#16:** P2-DOC was extended (now S-M). The roadmap's Pixel 5 references are replaced, and G1 evidence now requires the documents' bodies to be reconciled. The listed errata in other documents are executed in V2-00, not in this planning pass.
- **External fact re-checked** (optional #9): Supabase pricing, https://supabase.com/pricing, accessed 2026-11-10. Pro "starts at $25 per month", Free projects pause after 1 week of inactivity, and leaked-password protection is not on Free. Vertex `asia-south1` models, Razorpay limits and Sentry regions were **not** re-checked; Sentry is no longer used.

**Independence note.** This addendum and the roadmap revision were written by the principal-architect agent that integrated the documents. They still need the isolated G1 review (§16) before they count as independently checked.

## PO decisions addendum 3 (2026-11-10, round 2)

**Source.** The PO's written round-2 answers of 2026-11-10 to the decisions listed after revision 3, recorded verbatim:

> For Budget currently for 2-3 months we are going live with Free Tiers of both Supabase & Vercel
> GST: 1499 excluding GST not including
> AI Pricing: Seems fair but should be configurable going forwards as we intent to launch AI Voice Receptionist -> for that pricing would be drastially different. I think instead of misleading and loosing trust, lets not give an option of AI yet at all to suers to subscribe to, Just mark it as coming soon. For Trails yes we will enable by default of 1500 draft requests but silently, just a note somewhere saying that AI fearures are in "preview" mode and not offered yet somehtign on those lines and once we are done with AI Voice Bot then we can enable them from backend so Users can purchase them whenever they need.
> CAPTCHA yes add for signups
> Rest all is fine

**Gate.** The PO approved **G1 (discovery accepted) on 2026-11-10 with these amendments.** The amendments were applied by the planning agent; they have not had a separate isolated review. V2-00 may start.

**Answers recorded.**

| PO item | Answer | Roadmap effect |
|---|---|---|
| PO-13 | Default accepted ("Rest all is fine") | Go-live = 5 clinics × 3 users; low-end Android, desktop Chrome, one iPad |
| PO-16 | Default accepted | No API consumers; `/api/v1` stays disabled behind its env switch |
| PO-17 | **Replaced:** free tiers of Supabase and Vercel for the first 2–3 months after go-live | New §9.1 (limits, compensating controls, upgrade triggers and procedure); new track FT-01…FT-08; R24–R28; no external pen test |
| PO-19 | Default accepted | Working name "ClinicQ", teal "Q" icon, `auth.` email subdomain |
| PO-20 | **₹1,499 excluding GST** | ₹1,499 + 18% GST = ₹1,768.82 debited (CGST/SGST ₹134.91 each or IGST ₹269.82); Razorpay plan amount 176882 paise; `plan_prices` gains `base_amount_paise`, `tax_rate_bp`, `tax_inclusive = false`; "₹1,499 + GST" everywhere; GST registration is a go-live blocker (C44) |
| PO-21 | **No purchasable AI in v2.0**; AI "Coming soon"; trial scribe on by default with 1,500 drafts, labelled "Preview"; pricing configurable for the future AI Voice Receptionist; enable sales from the backend later | SUB-11 deferred; AI-18 moved to V2-05 as non-purchasable catalogue rows + trial quota + `platform.set_product_availability`; catalogue prices gain a `billing_model`; all AI safety controls (opt-in, objection, pseudonymisation, per-section accept, Vertex `asia-south1`, kill switch) still apply to preview use (C41) |
| PO-22 | Default accepted | Substance-level allergy checks only; Claude-reviewed eval labels under risk acceptance; notice + objection flag; AIR-9 accepted |
| PO-23 (a)–(i) | Accepted; CAPTCHA confirmed explicitly | Turnstile in Managed mode on every endpoint Supabase's single CAPTCHA switch covers (C43); (h) updated for the app-side HIBP call and the India-only backup job |
| **New PO-24** | Raised by the answers: production hosting must allow commercial use | Recommendation: Vercel Pro from go-live; **no default** (a default would override the PO's free-tier choice), PO decision pending; Hobby for development, previews and staging. BLOCKING for go-live (R24) |
| **New PO-25** | Raised by the answers: AI after the trial | Default: preview ends when the trial ends; alternative: keep the preview quota for paying clinics by SQL |

**New rulings (roadmap §10.3).** C41 (no AI sales in v2.0; supersedes C33/C34), C42 (free-tier hosting vs Vercel's terms), C43 (CAPTCHA scope), C44 (GST-exclusive price).

**External facts checked for this addendum** (research brief, accessed 2026-11-10; not re-verified by an independent agent):
- **Vercel Hobby:** "Hobby teams are restricted to non-commercial personal use only. All commercial usage of the platform requires either a Pro or Enterprise plan"; "Any method of requesting or processing payment from visitors of the site" is commercial use; Vercel "can directly pause the account or deployment". Hobby cron at most once a day (±59 min); runtime logs 1 hour; 1 developer seat; no Git-organisation repositories; preview password protection not on Hobby. Pro US$20/month per seat with US$20 usage credit. Sources: https://vercel.com/docs/limits/fair-use-guidelines, https://vercel.com/kb/guide/why-is-my-account-deployment-blocked, https://vercel.com/docs/cron-jobs/usage-and-pricing, https://vercel.com/docs/limits, https://vercel.com/pricing, https://vercel.com/docs/deployment-protection. Single Hobby region `bom1` is **not tested**.
- **Alternatives:** Netlify Free allows commercial use but has no Mumbai region (default Ohio; region change needs Pro, nearest Singapore); Cloudflare Workers Free has 10 ms CPU per request; Render Free sleeps after 15 min; Railway (Singapore) and Fly.io list no Mumbai region. Sources as cited in the research brief (Netlify docs and blog, Cloudflare Workers pricing, OpenNext, Railway and Fly.io region lists, Render docs).
- **Supabase Free:** 500 MB database, 1 GB Storage, 5 GB egress (+5 GB cached), 50,000 MAU, 500K Edge Function invocations, shared CPU / 500 MB RAM; 2 active free projects across all organisations where the user is Owner or Administrator; pausing after insufficient weekly database activity (warning first; restorable for a year); over-quota restrictions (pause, read-only, 402) across the organisation after one grace period; **no automatic backups and no PITR** (Supabase advises `supabase db dump`); leaked-password protection Pro and above; API/DB logs 1 day and auth audit logs 1 hour; custom SMTP included (default 30 emails/hour); no custom domain, branching, SLA or SOC 2; in-place upgrade lifts restrictions immediately. pg_cron runs "every second to once a year"; plan availability **not stated** (to check in V2-04); pg_cron activity counting against pausing comes from a staff comment (**Assumption**). No clause restricting commercial use was found; the Terms page timed out, so the PO reads https://supabase.com/terms before go-live. Sources: https://supabase.com/pricing, https://supabase.com/docs/guides/platform/backups, https://supabase.com/docs/guides/platform/billing-on-supabase, https://supabase.com/docs/guides/platform/billing-faq, https://supabase.com/docs/guides/platform/free-project-pausing, https://supabase.com/docs/guides/auth/password-security, https://supabase.com/docs/guides/auth/auth-smtp, https://supabase.com/docs/guides/cron.
- **Razorpay:** a plan is created with name, amount (paise), currency and description, and plans cannot be updated or deleted; `tax_inclusive`/`tax_rate` appear only in sample responses, not as inputs. So the GST-exclusive plan amount is 176882 paise (**confirm in test mode** that Razorpay adds nothing). Subscription invoices are not documented as GST tax invoices, so ClinicQ issues its own (SAC 998314 default, Unconfirmed; 998314 is IT design and development, while SaaS is more often billed under 998315 (hosting and IT infrastructure provisioning) or 997331 (software licensing): to check with the GST registration). UPI subscription debits are capped at ₹15,000 (₹1,00,000 for some categories); a future annual plan at about ₹17,688 incl. GST would exceed it. Sources: https://razorpay.com/docs/api/payments/subscriptions/create-plan, https://razorpay.com/docs/payments/subscriptions/faqs?preferred-country=IN.
- **Supabase CAPTCHA and Turnstile:** one "Enable CAPTCHA protection" switch; per the Auth server source it covers `/signup`, the `/token` password grant, `/otp`, `/magiclink`, `/recover`, `/resend`, `/sso` and passkey options, not `/verify` or refresh/PKCE/id_token grants; admin-credential calls skip it. Turnstile Free: unlimited challenges, 20 widgets; Invisible mode needs the Turnstile Privacy Addendum referenced in the privacy policy. Sources: https://supabase.com/docs/guides/auth/auth-captcha, https://raw.githubusercontent.com/supabase/auth/master/internal/api/api.go, https://raw.githubusercontent.com/supabase/auth/master/internal/api/middleware.go, https://developers.cloudflare.com/turnstile/plans/.

**Documents changed (planning only; no app code, configuration or provider changes):**
- **V2_MASTER_ROADMAP:** header status (revision 4, G1 approved); §1.1; §1.2 (PO-6/7 note, PO-9, PO-13/16/17/19/20/21/22/23 ✅, new PO-24 and PO-25, sources); §1.3 note; §6 C22; §9 rows and new **§9.1 Free-tier operating mode**; §10.1 (P0-16a/b, P1-25); §10.2 (SUB-01/05/08/09/10, SUB-11 struck, AI-02/03/18, AUTH-04/09, new **FT track**); §10.3 (C33/C34 superseded; C41–C44); §11 (flags, diagram, mapping); §12 (V2-00, V2-DX, V2-03, V2-04, V2-05, V2-09c, V2-11, V2-12, V2-13b, V2-13c, V2-14, V2-15, each keeping all seven fields); §13 (PO-side table, R10, R13, R17, new R24–R28, assumptions); §14 (V2-03, V2-04 M→M-L, V2-13b XL→L-XL, V2-14, V2-15; milestone stays XL); §15 (items 7, 8, 13, new 14); §16 (G1 approved, G5, G6); §17 (free-tier and upgrade variants, Razorpay, GST, AI); next step.
- **SUBSCRIPTIONS_AND_PLANS:** round-2 banner; §0; R1, R3; §3 amounts; §4 GST-exclusive rules; §5/§6.3 notice amounts; §7.1 catalogue (`purchasable`, `visibility`, `billing_model`, GST-exclusive price fields; `tenant_addons` deferred); §7.2; §7.3 (no upsell; Preview; Coming soon); §7.4 deferred; §8.1 seeds and runbook RPCs; §8.2; §9.3; §11; §12 (SUB-D1 ✅, SUB-D2 ✅, SUB-D8 deferred); §13.
- **AI_STRATEGY:** round-2 banner; §0.2; §4.6 (entitlement, quota, lifecycle table, opt-in note); §5.3 (Preview, Coming soon, copy grep); §6 (voice receptionist row and keys; not sold in v2.0); §6.3 (configurable billing models; trial decided); §10 (D-1/D-2 decided; D-8–D-11 accepted); §11 (AI-02, AI-18).
- **AUTH_REDESIGN:** round-2 banner (CAPTCHA scope C43; Free-plan gaps and FT-05/06/07); §0; §4.1 (HIBP, CAPTCHA, email limit, session settings); §4.4; §5; AR-8; PO-A1/PO-A7 accepted; §9 acceptance lines.
- **INFRASTRUCTURE_ASSESSMENT:** §1 banner; §4.1 production row; §4.5 Vercel Cron note; §4.7 free-tier backup banner; I-10 → P0; §6 Q8 answered.
- **DATA_HANDLING:** §4 processors banner (AWS S3 backups, HIBP call, Turnstile scope, AI preview); §5 backups row; §10 banner.
- **DESIGN_SYSTEM** §4.6 and **INFORMATION_ARCHITECTURE** §3.3: no AI upsell; "Preview" chip and note; "Coming soon" row; "₹1,499 + GST" labels.
- **PWA_STRATEGY** (Vercel note), **TEST_STRATEGY** §9 (restore drill, k6 baseline), **SECURITY_VERIFICATION_PLAN** §9 (free-tier checks).

**Remaining open items.**
1. **PO-24** (BLOCKING for go-live; no default): choose option 1 (Vercel Pro, recommended), 2 or 3 (with a recorded risk acceptance) in writing.
2. **PO-25:** confirm that the AI preview ends with the trial (default) or keep it for paying clinics.
3. **PO-side facts and tasks:** GSTIN, legal name and state (GST registration before go-live); Razorpay KYC; AWS bucket and scheduled task for backups; pausing or deleting the v1 test project before staging is created; reading the Supabase Terms.
4. **To confirm during execution:** Hobby `bom1` region (V2-03); pg_cron/pg_net on Free and the heartbeat effect (V2-04); Razorpay adds nothing to a 176882-paise plan (V2-13b test mode); single-use Turnstile tokens and the CAPTCHA endpoint list (AUTH-00); network restrictions and SSL enforcement on Free (V2-15).

**Independent review of the round-2 edits (2026-11-10).** An isolated reviewer returned "not ready yet: 9 required, 9 optional". Each claim was checked against the documents (and, for external facts, the cited Supabase and Vercel pages) before applying it. **All 18 were confirmed and applied; none were rejected.**
- **R1–R3 (PO-24 had a default that overrode the PO's "Free Tiers of both … Vercel"):** PO-24 now carries a **recommendation (Vercel Pro) and no default**; production stays on Hobby until the PO picks an option in writing. G6 cannot pass on Hobby unless the PO chose option 3 in writing with a recorded risk acceptance. Applied in the roadmap (§1.1 summary, §1.2 status and PO-24 row, environments row, §9.1, FT-08, C42, R24, assumptions, §17, next step), INFRASTRUCTURE_ASSESSMENT (banner, production row, Q8), DATA_HANDLING §4 banner, PWA_STRATEGY (E15, Skew note, budget note, banner) and this addendum's PO-24 row and open items.
- **R4 (archive timing, confirmed):** a clinic cancelled in trial expires on day 14 (about day 18 with grace) and archives 30 days later, so archives can fall due from about day 44, inside the free-tier window; purges cannot (expiry + 180 days). SUB banner and R10 corrected; archive takes an on-demand FT-02 dump first while on Free; export bundles count in FT-04 or go to the S3 `ap-south-1` bucket.
- **R5:** SUB §6.4 deletion certificate states 30 days (FT-02 dumps) while on Free.
- **R6 (confirmed S3 behaviour):** on a versioned bucket, expiry creates noncurrent versions that persist without a separate rule. FT-02 row and DATA_HANDLING §5/§10 now specify current-version expiry at 30 days, noncurrent expiry 1 day after, and expired delete-marker removal, verified by the FT-02 acceptance check.
- **R7 (confirmed, Supabase backups guide):** PITR needs at least Small compute; upgrade step added (short restart, outside OPD hours); cost ≈ US$130/month for Supabase.
- **R8:** §17 split into "Upgrade variant" (Supabase Pro line only) and "Both variants (at go-live)"; log drain is per PO-24 (FT-07 app tables on Hobby).
- **R9:** stale G1 status and C33/C34 "second subscription" text marked superseded by C41 (SUB banner, AI banner and §-recommendation, C33/C34 rows here).
- **Optional (all applied):** (1) G1 evidence: R23 is covered by PO-22 ✅; **C13 (interim role-aware RLS exposure) and R13/R22 (self-review, no legal counsel) are taken as accepted by the G1 approval ("Rest all is fine") but were not itemised in the round-2 question, so the PO is asked to confirm them explicitly at G2**; ADR-005 ratification moved out of G1 (it remains a V2-01 start condition; ARCHITECTURE_DECISIONS stays "Proposed"). (2) Owner opt-in for AI preview labelled "Deviation (PO to accept)". (3) Hobby usage caps added to §9.1; k6 on staging capped or run after PO-24. (4) AI plan total now "₹1,998 + GST = ₹2,357.64". (5) PWA Vercel Pro statements end "(see PO-24; pending)". (6) v1 test project must be paused or deleted before staging is created in V2-03. (7) AIR-9 accepted (PO-22 ✅). (8) PITR "after the Pro upgrade" in DATA_HANDLING §4 and INFRASTRUCTURE §1. (9) SAC code flagged: 998314 is IT design and development; SaaS is more often 998315 or 997331; to check with the GST registration. Roadmap line 8 notes rulings now run to C44.

**Independence note.** This addendum and the round-2 edits were written by the planning agent. The external facts come from one research brief and were not re-verified by an independent agent.

## PO decisions addendum 4 (2026-11-10, round 3)

**Source.** The PO's round-3 decision of 2026-11-10, recorded verbatim:

> I'll handle Vercel actually its not 2-3 months, its only for user acceptance testing in real world where we will give the refunds or coupon codes to users to test the product, don't worry about vercel (Yes we need to add coupon/discount codes) in our setup

**Coordinator rulings applied (R1–R6)** and the roadmap entries they map to:

| Ruling | Decision | Roadmap effect |
|---|---|---|
| R1 Vercel | **PO-24 closed: handled by the PO personally.** | R24 closed; C42 superseded by **C45**; Vercel removed from blockers (§1.3), risks, FT-01/FT-08, G6 and §17; only neutral technical notes remain (scheduler via Supabase pg_cron, C22; `bom1` desirable; Skew Protection and log drain if available). Vercel citations [V1]/[V-FU] removed from §1.2 (kept in addendum 3 as history). |
| R2 Free tiers | Free tiers apply **only to a real-world UAT stage after all of v2 is complete**, where testers get coupon codes (refunds as the exception). Paid launch follows UAT. | **C46.** New phase **V2-16 Real-world UAT & paid launch** (chosen over folding UAT into V2-15, because UAT has its own duration, exit criteria and upgrade step); **G6 = UAT start**, new **G7 = paid launch**; §9.1 rescoped (planned Supabase Pro + PITR upgrade at UAT exit; the "90 days after go-live" and "first paying clinic beyond the pilot" triggers removed; remaining triggers become early-upgrade triggers during UAT); FT controls stay mandatory during UAT (real patient data possible); §17 split into §17.1 UAT start and §17.2 paid launch; GSTIN moved from a G6 to a G7 blocker (UAT codes debit nothing). New open item **PO-26** (confirm the Supabase upgrade timing; default at UAT exit, before the first full-price charge). |
| Coupons | "Yes we need to add coupon/discount codes." | **C47.** SUBSCRIPTIONS_AND_PLANS §14 (written in this round) adopted: track **SUB-COUPON-01…08** (about L) placed in V2-13b (-01/02/03/04/05/07; -03 may slip past paid launch), V2-13c (-06) and V2-15/V2-16 (-08); V2-13b re-sized L-XL → XL (split allowed at plan time); V2-14 adds coupon abuse tests; new risk **R29**. |
| R3 CAPTCHA | Turnstile **Managed** mode on all Supabase-enforced auth endpoints is the **accepted default** (a superset of "add for signups"; Supabase's switch cannot be scoped); the custom signup-only path is the rejected alternative. | C43 annotated; AUTH_REDESIGN round-3 banner; DATA_HANDLING §4. |
| R4 AI preview consent | Keep a one-time clinic-owner opt-in for the preview (data goes to Google); the 1,500-draft quota stays silent. "Silently" = no purchase/upsell flow and no quota marketing, not sending patient data without the clinic's consent (DPDP consent; the PO explicitly wants to avoid losing trust). **Decided.** | **C48**; PO-21 row and AI_STRATEGY §4.6 lose the "Deviation (PO to accept)" label; §15 item 8 and §17.1 AI line updated. |
| R5 C13, R13/R22, ADR-005 | C13 **closed** (big-bang model: no live clinic data exists before V2-05 lands; V2-05 stays a UAT/paid-launch blocker). R13 and R22 **PO-accepted** per PO-10 ("Claude can review everything") and PO-12. ADR-005 is ratified **as part of G0** by the isolated Claude reviewer with the PO's G0 sign-off (not a separate PO decision). | §10.3 C13; §13 R13/R22; §16 G1 and G0 rows; ARCHITECTURE_DECISIONS ADR-005 note; status line and next step. This closes open item (1) of the addendum-3 independent-review optional findings ("PO asked to confirm C13 and R13/R22 explicitly at G2"). |
| R6 PO-25 | Default stays "preview ends with the trial; AI shows Coming soon", pending the PO. | PO-25 is the only open product decision besides PO-26. |

**Documents changed (planning only; no app code, configuration or provider changes):**
- **V2_MASTER_ROADMAP** (revision 5): status line and evidence base; §1.1 (recommendation step 5, platform paragraph, SUB track, 23 phases); §1.2 (status; PO-6/7, PO-10, PO-12, PO-15, PO-17, PO-21 rows; PO-24 closed; PO-25 open; new PO-26; sources); §1.3 note and item 9; §6 C22; §9 rows; §9.1 rewritten for the UAT stage; §10.1 (P0-16b, P1-25, P1-35b); §10.2 (SUB-10, SUB-COUPON-01…08 with the Unconfirmed facts, AUTH-04, FT-01, FT-08); §10.3 (C13 closed, C42 superseded, C43 accepted default, new C45–C48); §11 (round-3 note, principles, diagram with V2-16 and G7, rationale, mapping); §12 (V2-03, V2-13b, V2-13c, V2-14, V2-15 renamed "Production readiness & UAT launch", new V2-16, each with all seven fields); §13 (critical path, PO-side table, R10, R13, R22, R24 closed, R25, R27, R28, new R29, assumptions); §14 (V2-13b XL, V2-13c, V2-15, new V2-16; milestone stays XL; assumptions); §15 (items 7, 8, 13, 14); §16 (G1, G0, G6 UAT start, new G7 paid launch); §17 split into §17.1 UAT start and §17.2 paid launch; next step.
- **SUBSCRIPTIONS_AND_PLANS:** §14 and related sections (written earlier in this round); this pass adds the roadmap placement (V2-16, G6/G7, PO-26) to the §0 banner, §4 GSTIN timing, §14.8 and the SUB-COUPON-08 phase.
- **INFRASTRUCTURE_ASSESSMENT:** round-3 banner; round-2 banner Vercel/scheduler/trigger bullets; §1 platform line; Vercel plan-limits row; production environment row; §4.5 note and Vercel Cron option; §4.7 backup banner; §6 Q4 and Q8.
- **DATA_HANDLING:** §4 round-3 banner (Vercel, UAT-only Free, Turnstile, AI consent, coupon and refund records); round-2 Supabase and Vercel bullets; §10 backup banner.
- **AUTH_REDESIGN:** round-3 banner (CAPTCHA accepted default with the rejected alternative; Free only during UAT; code entry at signup); round-2 Free bullet; §0 recommendation; AR-8; V2-13c acceptance (G6 and G7).
- **AI_STRATEGY:** round-3 banner (consent decided, PO-25 open, UAT preview per SUB-D10); §4.6 lifecycle table and note.
- **PWA_STRATEGY:** E15, Skew Protection fact, budget note, round-2 banner replaced by a round-3 note, review row 5.
- **TEST_STRATEGY** §9 items 8 and 9; **SECURITY_VERIFICATION_PLAN** §9 (Vercel row removed, coupon row added, PITR row); **ARCHITECTURE_DECISIONS** ADR-005 ratification note.

**Stale-reference sweep.** All `docs/v2` files except `prompt.md` and the historical addenda in this log were searched for "PO-24 pending/blocking", "Vercel Pro", "Hobby", "first 2–3 months", "90 days after go-live", "G6 … Hobby risk acceptance", "C13 … accepted/confirm", and "Deviation (PO to accept)" on the AI opt-in. Remaining hits are intentional: quotations of the PO's round-2 words, dated round-3 notes that explain the change, and earlier addenda in this log (history).

**Remaining open items.**
1. **PO-25** (default applies): AI preview ends when the trial ends; AI shows "Coming soon".
2. **PO-26** (confirm; default applies): Supabase Pro + PITR upgrade at UAT exit, before the first full-price charge (or earlier on a §9.1 trigger, or at UAT start if the PO prefers).
3. ~~**SUB-D9…D11** (defaults apply)~~ *Relabelled by the review disposition below (fix 3):* SUB-D9 (real mandate) and SUB-D10 (AI preview until `free_until`) are **adopted defaults (PO may override)**; SUB-D11 (the UAT exit date, no extra free months) is a **PO operational input**, not a product decision. **Open product decisions: PO-25 only; PO-26 = confirm the upgrade timing.**
4. **PO-side tasks:** Razorpay KYC (live mode needed at UAT start, or the comp fallback); GST registration before paid launch; recruiting the UAT clinics; AWS backup bucket; Supabase Terms read.
5. **To confirm during execution:** the three Unconfirmed Razorpay behaviours on the SUB §14.9 test-mode checklist (offer effect on the ₹5 authorisation, the longest future `start_at`, expired offers on linked subscriptions) in V2-13b; the effective date of the 2026 GST amendment on post-sale discounts (with the GST registration); plus the addendum-3 execution checks (pg_cron on Free, Razorpay plan amount, CAPTCHA endpoint list, network restrictions on Free).

**Independence note.** This addendum and the round-3 roadmap edits were written by the planning agent under the coordinator's rulings; they have not yet had a separate isolated review. The coupon research in SUB §14 cites sources [S29]–[S37] (accessed 2026-11-10) and was not re-verified by an independent agent. *(Closed by the review disposition below.)*

### Review disposition: independent review of the round-3 integration (2026-11-10)

An isolated reviewer returned "mostly correct and consistent, not ready to sign off: 9 required, 8 optional". Each claim was checked against the documents before editing; the GST arithmetic was recomputed (half-up per tax line on base 149900 paise at 18 %: totals differ by a paisa at 5, 15, 25, 30, 40, 50 % and more; 50 % → 88441 IGST vs 88442 CGST+SGST; the old credit-note formula gives 74951 taxable for a full refund of 88442). **Rejected: none.**

| # | Finding | Disposition |
|---|---|---|
| 1 | Coupon GST rounding refuses common discounts | **Applied.** One Razorpay offer per (coupon, price, supply type); `coupon_provider_offers.supply_type` with UNIQUE (`coupon_id`, `plan_price_id`, `supply_type`); both offers required before enable; checkout picks by billing-profile state. SUB §14.3, §14.4, §14.9 (50 % = 88442 / 88441), §14.11; roadmap SUB-COUPON-01/-03 and V2-13b tests. |
| 2 | Credit-note maths does not round-trip | **Applied.** Full refund = exact reversal of the invoice lines; partial = invoice's own taxable ÷ total ratio; final credit note takes the remainder; test that credit notes sum to the invoice. SUB §14.7, §14.9; roadmap V2-13b tests. |
| 3 | Open-decision list contradicts R6 | **Applied.** SUB-D9/D10 = adopted defaults (PO may override); SUB-D11 = PO operational input. Roadmap §1.2 status, §10.2 note, V2-13b/V2-15 dependencies, §17 next step; SUB §12 row and §14.12 heading; item 3 below. "Open product decisions: PO-25 only; PO-26 = confirm upgrade timing." |
| 4 | No plan for G7 slipping past the UAT exit date | **Applied.** G7 ≥ 5 days before the earliest `free_until`; otherwise the slip runbook before T-3 (`comp_until` + cancel before first debit; re-confirm AutoPay at paid launch; alternative re-confirm task with a later `start_at`); no debit without a GSTIN. SUB §14.8, §14.10 #8, SUB-COUPON-08; roadmap §9.1 (trigger 5 flagged), V2-16 dependencies, G7 row, §17.2. |
| 5 | R27 cites "trigger 6" | **Applied** → trigger 4. |
| 6 | GSTIN "before go-live" in SUB | **Applied** (SUB-D1 row, SUB-10 row, §13.2 critical-path supersession note, "(none of these rows exist yet)" dropped; also the §4 "register before go-live" default). |
| 7 | C22 row in §4 and INFRA Q8 carry Vercel plan wording | **Applied** (C22 row below; INFRA §6 Q8 question struck through). |
| 8 | Remaining "where the plan offers it" wording | **Applied** ("if available" in roadmap V2-15 scope and expected changes, §9 observability, P1-25, PO-6/7, PO-24, C45; INFRA line 13; PWA E14/E15/§556 note; the R1 row above). |
| 9 | Late UAT sign-ups | **Applied.** `start_at = max(trial_end, free_until)`; pgTAP case; V2-16 note. |
| Opt. | AI quota during UAT; `?code=` stripping; §11 diagram; TEST_STRATEGY pointer and §9 item 12; THREAT_MODEL AC-7; AUTH AR-5 and §5 item 3; Supabase DPA assumption; this disposition | **All applied.** UAT AI grant = 1,500 drafts per IST calendar month until `free_until` (cost ceiling about ₹225 per clinic per month, Assumption); the 14-day trial keeps 1,500 for the whole trial (PO-21). |

This disposition closes the independence note above for the round-3 edits. The coupon sources [S29]–[S37] were spot-checked by the reviewer (Offers page; "How Subscriptions Work") and match the documents.

---

## P2-DOC errata applied (V2-00, 2026-11-10)

Backlog item P2-DOC (roadmap §10.1). Each correction is made in the body text of the target document and carries a trailing marker "(erratum 2026-11-10, <ruling>)". Line numbers quoted in the P2-DOC row were checked first; shifts are noted.

| # | Target file and section | Ruling | Status |
|---|---|---|---|
| 1 | `SECURITY_ASSESSMENT.md` §3 (public API fact): "no tenant-scoping gap" replaced by the lab-orders `storage_path` gap (ARC-06 / API-05, H/P0, P0-05) | C1 | Applied |
| 2 | `SECURITY_ASSESSMENT.md` §5 (positive controls, `/api/v1` scoping bullet) | C1 | Applied |
| 3 | `THREAT_MODEL.md` §3.4 row "Tenant scoping in handlers": ✅ → ⚠️ with the ARC-06 gap; 14 handlers → 15 route files (13 data routes) | C1, C6 | Applied |
| 4 | `API_ASSESSMENT.md` §4 (inbound messaging webhooks row): `dev`/unknown providers have no environment gate; priority P1 → Critical/P0 (P0-03) | C2 | Applied |
| 5 | `API_ASSESSMENT.md` §7 (findings register): SEC-04 P0 row added | C2 | Applied |
| 6 | `SECURITY_ASSESSMENT.md` §3 (DB access modes): 5 service-role factories, adds `features/auth/dev-actions.ts` | C3 | Applied |
| 7 | `ARCHITECTURE_ASSESSMENT.md` §3 (diagram ×4 → ×5; facts list "four" → five, adds `lib/storage/supabase-provider.ts`), register ARC-13 | C3 | Applied |
| 8 | `ARCHITECTURE_DECISIONS.md` ADR-005 context ("four" → five, listed) | C3 | Applied |
| 9 | `BACKEND_MIGRATION_PLAN.md` B8 ("three duplicate factories" → four duplicates, 5 in total) | C3 | Applied |
| 10 | `ARCHITECTURE_ASSESSMENT.md` register ARC-11 (13 → 29 sites); `ARCHITECTURE_DECISIONS.md` ADR-016 context (13 → 29) | C4 | Applied |
| 11 | `ARCHITECTURE_ASSESSMENT.md` §3 diagram (6 → 8 SECURITY DEFINER functions) | C5 | Applied |
| 12 | `SECURITY_ASSESSMENT.md` §3; `API_ASSESSMENT.md` intro and §1 table (13 → 15 route files, 13 data routes); `ARCHITECTURE_ASSESSMENT.md` §1 summary and §8 inventory | C6 | Applied |
| 13 | `DATABASE_ASSESSMENT.md` §2 (44 → 43 distinct tables) and RLS-11 (8 of 44 → 8 of 43) | C7 | Applied |
| 14 | `ARCHITECTURE_ASSESSMENT.md` §3 facts; `API_ASSESSMENT.md` §1 table and §2.3 ("about 230" → 137 in `features/`, 198 incl. `app/`) | C8 | Applied |
| 15 | `DATABASE_ASSESSMENT.md` §7 DB-21 retention bullet (NMC 3 years → IMC 2002 reg. 1.3.1 + state rules, ⚖) | C29 | Applied |
| 16 | `SECURITY_ASSESSMENT.md` §1 executive summary item 1 and SEC-01 heading (4 confirmed browser-reachable; `getPatient`/`getPatients` pending OI-6) | C31 | Applied |
| 17 | `TEST_STRATEGY.md` §10 T-14 (P2 → P1, per-journey with V2-08 to V2-11, P1-42) | C32 | Applied |
| 18 | `ARCHITECTURE_DECISIONS.md` index row 003 and ADR-003 body (status Superseded; RPC-per-flow decision; original proposal kept for the record; consequences rewritten) | C18 | Applied |
| 19 | `ARCHITECTURE_DECISIONS.md` index row 011 and ADR-011 decision (`api_authenticate()` + explicit RPCs or short-lived principal JWT; no `withTenantTx`) | C18 (R7) | Applied |
| 20 | `ARCHITECTURE_DECISIONS.md` index row 006 and ADR-006 decision (hard-coded `CASE` `has_permission()`, parity unit test, no `role_permissions` table) | C19 | Applied |
| 21 | C19 knock-ons: `BACKEND_MIGRATION_PLAN.md` §8 role-aware RLS note; `ARCHITECTURE_ASSESSMENT.md` §4.3; `DATABASE_ASSESSMENT.md` RLS-02; `SECURITY_REMEDIATION_PLAN.md` P1-1; `SECURITY_ASSESSMENT.md` SEC-06 remediation; `TARGET_ARCHITECTURE.md` §3.3 | C19 | Applied |
| 22 | `SECURITY_VERIFICATION_PLAN.md` §2 custom Semgrep rule 2 (dropped; ADR-005 list via ESLint `no-restricted-imports`, P1-34) and the ESLint tool row | C20 | Applied |
| 23 | `SECURITY_ASSESSMENT.md` SEC-08 … SEC-33: **Component** added to all 25 findings; **Impact** added to SEC-12, 17, 19, 21, 22, 23, 24, 27, 28, 29, 30, 32; **Verification** added to SEC-22, 23, 28, 30, 33 (from `SECURITY_VERIFICATION_PLAN.md` TC-IDs / §4 / §6.1) | P2-DOC template | Applied (content taken from each finding's own evidence and from VERIFICATION_LOG §1.1 / SECURITY_VERIFICATION_PLAN) |
| 24 | `SECURITY_ASSESSMENT.md` SEC-21, SEC-27, SEC-32 Verification field | P2-DOC template | **Partially applied:** field added but reads "Not specified in the source documents; to be defined in V2-14", because no test case exists in any docs/v2 file |
| 25 | `TARGET_ARCHITECTURE.md` §3: new §3.9 Frontend framework (§10.1), §3.10 Component library, styling and design system (§10.2/§10.3), §3.11 Testing infrastructure (§10.10), §3.12 Security tooling (§10.11), sourced from FRONTEND_TECHNOLOGY_ASSESSMENT, DESIGN_SYSTEM, TEST_STRATEGY, SECURITY_VERIFICATION_PLAN and roadmap §5/§8 | Consistency review (§4 note) | Applied |
| 26 | `TEST_STRATEGY.md` §6.1 E2E row and §7 intro (`:247`): Pixel 5 lane → PWA §9.1 device matrix + PWA specs 1–11 | PWA §12 | Applied |
| 27 | `TEST_STRATEGY.md` §7 journey 1 (`:249`): OTP → password login (J-A3) | PWA §12 / AUTH | Applied |
| 28 | `TEST_STRATEGY.md` §8 nightly row (`:269`, device matrix) and pre-release sign-off (`:270`, isolated Claude reviewer + PO device run) | PWA §12 | Applied |
| 29 | `DESIGN_SYSTEM.md` §6.9 save-status text (row cited `:527`, now `:537`) and §6.11 Offline row (cited `:549`, now `:559`): no local drafts | PWA §12 | Applied (line numbers shifted by the earlier PO-decision banner) |
| 30 | `UX_AUDIT.md` §5.7 save model (`:730`): server autosave + in-memory buffer | PWA §12 | Applied |
| 31 | `FRONTEND_TECHNOLOGY_ASSESSMENT.md` §6 offline-drafts row (`:172`): `idb-keyval` rejected for v2.0 | PWA §12 | Applied |
| 32 | `FRONTEND_MIGRATION_PLAN.md` `:71` (Devanagari not in root layout), `:169` M4.4 (restored to last autosave ≤ 5 s), `:222` performance row (report-only from M2, blocking at V2-15); also the Pixel 5 lane (`:156`, `:221`) and the M3 PWA scope row (PWA §12 item 4) | PWA §12 | Applied |
| 33 | `SECURITY_REMEDIATION_PLAN.md` P1-7: `worker-src 'self'`, `manifest-src 'self'`, `/sw.js` headers | PWA §12 | Applied |
| 34 | `SECURITY_REMEDIATION_PLAN.md` P1-9 → AI-04/AI-05 | AI §11.2 | Applied |
| 35 | `THREAT_MODEL.md` SR-8 → AI-04/AI-05, plus a v1-state note under §3.8 | AI §11.2 | Applied |
| 36 | `DATA_HANDLING.md` §1 sub-processor list and staff-accounts row; §4 processor table: Gemini/OpenAI row → Vertex `asia-south1`; R2 row struck (C23); rows added for AWS S3 backups, SES, Razorpay, Turnstile, HIBP and the India error sink (C39) | AI §11.2, AUTH §10, SUB §13.2, C39, C23, FT-02 | Applied |
| 37 | `DATA_HANDLING.md` §5 retention schedule: AI-metadata row | AI §11.2 | Applied |
| 38 | `TARGET_ARCHITECTURE.md` §3.6 (`:146`, `:151`): AI gateway at `lib/integrations/ai`, no AI-summary job; §8 job kinds (`:305`, now `:349`): `ai.summary` → `ai.reservations_cleanup` | AI §11.2 | Applied |

**Second pass (V2-00, 2026-11-10): items deferred by the first pass, now applied.** Same marker convention.

| # | Target file and section | Ruling | Status |
|---|---|---|---|
| 39 | `TARGET_ARCHITECTURE.md` §2 diagram (repo.ts = supabase-js + generated types + one plpgsql RPC per atomic command; `lib/db` = user-scoped client + `getSystemDb()`; data path = user JWT → PostgREST/`.rpc()` → RLS; Postgres box adds SECURITY INVOKER RPCs and `has_permission()`) plus a "Data path" note under the diagram | C18 | Applied |
| 40 | `TARGET_ARCHITECTURE.md` §3.1 operational note (no database URL secret) and §3.2 rewritten in full (RPC-per-flow recommended; Kysely/`withTenantTx` moved to alternative (a), superseded; generated Supabase types; D1 confirmation spike V2-03 plan 03-07); §3.4 layer (3) (user-scoped client; API keys per ADR-011) | C18 | Applied |
| 41 | `TARGET_ARCHITECTURE.md` §4 module contract (`repo.ts`/`service.ts` comments) and code sample (service → repo `.rpc('record_payment')` → `SECURITY INVOKER` plpgsql sketch); §6 error mapping (`P0001`/`P0002` raised by RPCs); §7 items 1, 3, 5 and the critical-flows intro (→ P1-05); §11 pgTAP bullet | C18 | Applied (§6 and §11 touched for consistency with §4/§7) |
| 42 | `BACKEND_MIGRATION_PLAN.md` §2 Phase D row; §7 D1 (confirmation spike, V2-03 plan 03-07), D2 (`getUserDb()`, `getSystemDb()`, error mapper, RPC conventions, `supabase gen types`), D3/D4 (one RPC per flow; audit written by the RPC); §8 E1 (`repo.ts`); §10 G4 (ADR-011 explicit RPCs or short-lived principal JWT); §12 risk row (RPC maintainability replaces Kysely/pooler risk) | C18 | Applied |
| 43 | `ARCHITECTURE_ASSESSMENT.md` §7 type-generation bullet (`supabase gen types`, no `kysely-codegen`); also §1 target recommendation and §6 recommendation (Kysely → RPC-per-flow) | C18 | Applied (§1/§6 added for consistency) |
| 44 | `DATABASE_ASSESSMENT.md` §10 (`supabase gen types` now and in the target state; `kysely-codegen` dropped) | C18 | Applied |
| 45 | `TEST_STRATEGY.md` §2.6 v2-disposition note (copilot specs and regex "evals" retired, replaced by AI §7 L1–L3) and the §5 coverage-gap AI row | AI §11.2 (deferred item 4) | Applied |
| 46 | `PWA_STRATEGY.md` §6.4 invite bullet (AUTH-D1 marker; the body already used the app-token link) and R-checklist: R1 adds Android install → sign in → close → reopen (iOS was already in R2); R11 extended to `/join` from WhatsApp and Gmail in-app browsers on Android and iOS | AUTH §10 (deferred item 6) | Applied |
| 47 | `AUTH_REDESIGN.md` §3.6: idle local sign-out via `hardSignOut('idle')` with the app-switcher snapshot cover (R14); staff-removal row; new "One exit helper" paragraph routing every sign-out path through `hardSignOut()`; §7 J-A9 cross-referenced to PWA §9.1 specs 1–5. Code-only OTP (no magic links) was already in §2 principle 3 and §3.1/§3.4, so no edit | PWA §12 item 8 (deferred item 7) | Applied |
| 48 | `SUBSCRIPTIONS_AND_PLANS.md` §5.1 iOS standalone resume edge case ("Confirming your AutoPay…", never re-show "Start trial" while a `created` provider subscription exists); §7.2 layout redirects exclude the PWA §3.1 public assets; new §7.2 item 4 client lock handling (`SUBSCRIPTION_LOCKED`, access level in the resume poll, Realtime unsubscribe, D-8 navigation keeping the session; later items renumbered 5–6, no external references to them) | PWA §12 item 9 (deferred item 7) | Applied |
| 49 | `SUBSCRIPTIONS_AND_PLANS.md` §7.1 `platform_settings` gains `ai_features jsonb` (AI kill switch). §7.3 key list already matched AI §6.2 (retired names listed), so no edit | AI §11.2 (deferred item 7) | Applied |
| 50 | `AUTH_REDESIGN.md` §3.1 "Ordering with billing" bullet: marker that the former "Open question SUB" is answered by SUB ruling R4 (mandate required; `incomplete` shows only "Start trial"). The body and the §9 update banner already said so | SUB §13.2 (deferred item 8) | Applied (marker only; substance was already present) |
| 51 | `GSD_WORKFLOW_ASSESSMENT.md` §5.3: erratum blockquote (8 keys not in the GSD 1.16.0 `config-schema.manifest.json`; `default_reviewers` → `["claude"]` (PO-10); `create_tag` false; `test_command` = `npm run typecheck`) | P1-36 (V2-00) | Applied (handled with the `.planning/config.json` work; leading blockquote banner instead of the trailing "(erratum 2026-11-10, <ruling>)" marker, an accepted exception) |
| 52 | `API_ASSESSMENT.md` §6 item 3: API-key principal via `api_authenticate()` + per-endpoint RPCs or a short-lived principal JWT; no `withTenantTx` / `SET LOCAL` (found by the G0 docs review) | C18 (ADR-011 amended) | Applied |

**Still not applied:**

| Target | Ruling | Reason |
|---|---|---|
| `DESIGN_SYSTEM.md` §4.2 (md/lg Today layouts, QA widths 744/820/1180, safe-area utilities) | PWA §12 item 1 (deferred item 5) | Design work, not an erratum: new layouts belong to the V2-DX design track. Skipped by instruction; still open for V2-DX. |

After the second pass, no file under `docs/v2/` other than `ARCHITECTURE_DECISIONS.md` (ADR-003 "Original proposal", kept for the record), `V2_MASTER_ROADMAP.md` and this log describes Kysely, `DATABASE_URL`, `withTenantTx` or its `SET LOCAL`/`request.jwt.claims` mechanism as the target (re-checked after row 52); every remaining mention is marked superseded (C18).

## G0 review disposition (2026-11-10)

Two independent isolated Claude reviews of V2-00 (config/safety and docs). Every claim was checked against the repo before any change. `.claude/settings.json` is applied by the coordinator, not by the agent that applied this pass.

**Config/safety review (required R1–R9)**

| # | Finding | Disposition |
|---|---|---|
| R1 | `Bash(npx eslint*)` has no word boundary (auto-approves `npx eslint-<pkg>`) | Applied by the coordinator in `.claude/settings.json`: `Bash(npx eslint)` + `Bash(npx eslint *)` |
| R2 | Deny `Read(./supabase/.temp/**)` (folder holds `pooler-url`, `project-ref`, `linked-project.json`; confirmed) | Applied by the coordinator in `.claude/settings.json` |
| R3 | Missing env-variant deny rules (`.env.test.local`, `.env.staging.local` reads; `.env.development[.local]`, `.env.staging` edits) | Applied by the coordinator in `.claude/settings.json`; `.env.example` and `.env.test` stay readable |
| R4 | `ask` list for test and env-file commands (`vitest.config.ts:5-20` loads `.env`; scripts use `--env-file=.env`; confirmed) | Applied by the coordinator in `.claude/settings.json` (also `npm run msg91:*`, which uses `--env-file=.env`) |
| R5 | `.gitignore` did not ignore `.env.production`, `.env.development`, `.env.staging` | Applied: `.env`, `.env.*`, `!.env.example`, `!.env.test` |
| R6 | `.planning/REQUIREMENTS.md` `[x]` / "completed in Phase 3" contradict the corrected Traceability table; stale "Last updated" | Applied: all checkboxes cleared, each item points to Traceability, footer dated 2026-11-10 (V2-00) |
| R7 | ADR-0005 says four service-role factories; C3 says five | Applied: five, listed by path |
| R8 | Rotation record misses `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`; P0-16a counts unsourced | Applied: both names added (read in `lib/storage`); counts dropped, PO-14 deletion cited as not re-verified |
| R9 | CLAUDE.md test instruction not actionable | Applied: states that `vitest.config.ts` loads `.env`; no vitest/playwright/scripts before V2-01a without PO approval; exact override command (adds `MESSAGING_PROVIDER=dev`); notes that empty overrides are refilled by the loader and that R2 cannot be disabled by override (PO confirms `R2_*` unset) |

**Config/safety review (optional O1–O9)**

| # | Finding | Disposition |
|---|---|---|
| O1 | `./.env` rules are cwd-relative; add `**/.env`, `**/.env.local` forms | Applied by the coordinator in `.claude/settings.json` |
| O2 | Bash deny rules are prefix patterns (bypassable via `awk`, `sed`, `python`, `node -e`, `source`, `cp`); the broader GSD `gsd-secret-read-guard.js` hook lives only in the untracked `settings.local.json` under a hard-coded nvm node path; neither stops a test process from loading `.env` | Applied as recorded limits (this row). Compensations: R4 `ask` rules, CLAUDE.md rule, V2-01a local harness with a non-local-URL guard |
| O3 | Server-side branch protection on `main` and `feature/v2` | Deferred to the PO (GitHub repository settings; outside the agent's remit). G0 evidence item |
| O4 | Local pre-commit hook rejecting commits on `main` / `feature/v2` (GSD only warns) | Deferred: `.git/hooks` is untracked and outside the allowed edit set; A2 is satisfied by phase branching + the `git checkout/switch main` deny. Revisit with gitleaks pre-commit (V2-02) |
| O5 | Record the GSD pin in the repo | Applied: `npx -y @opengsd/gsd-core@1.16.0 --claude --local` in CLAUDE.md. The installer's unpinned `Bash(npx gsd-core *)` allow in `settings.local.json` is noted; the PO removes or pins it locally |
| O6 | `Bash(git diff*)` → `Bash(git diff *)` | Applied by the coordinator in `.claude/settings.json` (plus bare `Bash(git diff)`) |
| O7 | Fuller ADR-0005 evidence list | Applied: `features/patients/actions.ts:174,255,278`, `consent.ts:163`, `settings/actions.ts:48,179` (verified) |
| O8 | `tests/helpers/tenants.ts`: `"node:crypto"` | Applied; isolated suite re-run: 442 passed / 206 skipped / 27 files failing on the dead endpoint (unchanged) |
| O9 | `workflow.use_worktrees: false` | Applied (key present in the GSD 1.16.0 schema manifest) |

**Docs review (required 1–5)**

| # | Finding | Disposition |
|---|---|---|
| 1 | `API_ASSESSMENT.md` §6 item 3 still describes the `withTenantTx` mechanism | Applied (errata row 52, C18) |
| 2 | `SECURITY_ASSESSMENT.md` SEC-06 remediation still ends with `current_user_role()` | Applied (C19) |
| 3 | `TARGET_ARCHITECTURE.md` §3.12 "external penetration test after P1" contradicts PO-17 / V2-14 | Applied |
| 4 | GSD §5.3 row in "Still not applied" is wrong; marker convention | Applied: row removed; errata row 51 added, banner form recorded as an exception |
| 5 | Closing sentence true only after fix 1 | Applied: reworded to include `SET LOCAL`/`request.jwt.claims`; re-grep after fix 1 finds only superseded mentions (ADR-003 original proposal, `TARGET_ARCHITECTURE.md` §3.2 alternative (a)) |

**Docs review (optional a–m)**

| # | Finding | Disposition |
|---|---|---|
| a | ADR-003 status: RPC pattern Proposed pending D1 (R6) | Applied |
| b | §7 item 1 `getSystemDb` sentence: `auth.uid()` is null under service role | Applied: explicit system-actor argument; system path confirmed in the D1 spike |
| c | §3.11 "nightly … L1–L3" | Applied: L1/L2 every PR, L3 manual per model/prompt change (AI §7) |
| d | §3.9 "about 110 server-action functions" | Applied with the C8 count |
| e | §7 critical-flows list and BACKEND D3 differ from P1-05 | Applied: both aligned to P1-05 (walk-in, register+book, collect); waitlist promotion, reschedule, erasure labelled later candidates |
| f | DATA_HANDLING §4 markers; log row 36 rulings | Applied: S3 row → FT-02; R2 row → C23; row 36 adds C23, FT-02 |
| g | Turnstile listed as a patient-data sub-processor | Applied: removed from the patient row. SES kept: "app email content" is not confirmed staff-only; re-check at G2 |
| h | FRONTEND_MIGRATION_PLAN M0 "Desktop + Pixel 5" | Applied: PWA §9.1 PR-lane projects |
| i | TEST_STRATEGY §7 intro: iPhone 15 golden path only | Applied |
| j | SECURITY_REMEDIATION_PLAN principle 3 lists API-key routes in the service-role allow-list | Applied (C20, ADR-011) |
| k | DB-21: reg. 1.3.1 covers indoor-patient records | Applied |
| l | SEC-19 severity line vs merge into SEC-04 (H/P0) | Applied: pointer to SEC-04 / P0-03 |
| m | §2 diagram border overshoot (lines 48, 56–60) and unpadded line 40 | Applied: all box lines 84 columns, padded |

No finding was rejected. Open for G0 sign-off (PO): A1 denied-read log, A2/A3 install and `/gsd-help` evidence, A5 rotation dates, acceptance of P0-16a "not required", O3 branch protection.

### G0 PO rulings and evidence (2026-11-10)

| Item | Outcome |
|---|---|
| A1 denied read | Produced by the tool in a Claude Code session on `v2/phase-00-preflight`: `Read` of `./.env.development.local` and `./tests/.env` both returned "File is in a directory that is denied by your permission settings" (tracked `.claude/settings.json`; nonexistent paths chosen so a failed rule could not expose a value). A Bash `ls` piped to a `.env` name filter was blocked separately by the local `gsd-secret-read-guard` hook |
| A2/A3 GSD | `.claude/gsd-core/VERSION` = `1.16.0`; `.planning/config.json` `protected_branches: ["main"]`, `allow_default_branch_commits: false`, base `feature/v2`; `gsd-*` skills (incl. `gsd-help`) load in the session |
| Retirement / tag | `.agents/`, `.opencode/`, `.gsd/` absent; `git rev-parse v1.0-mvp-baseline^{commit}` = `main` = `396ca9f` |
| A5 rotation | **PO ruling C49: not done in V2-00.** Test project is discarded at go-live; rotation of every secret not scoped to it (incl. revoking `SUPABASE_ACCESS_TOKEN`) is **mandatory before go-live in V2-15** (§17.1). PO accepts the interim risk. Applied to roadmap P0-07, V2-15 scope, §16 G0, §17.1 and `docs/ops/secret-rotation.md` |
| P0-16a | **Accepted as not required by the PO** |
| O3 branch protection | **Applied by the PO** on GitHub for `main` and `feature/v2` (PO statement; repository settings are outside the agent's remit) |
| Deny-rule gap found during A1 | `Write` was denied only for `./.env`, `./.env.production`, `**/.env`; added explicit `Write` (and missing `Edit`) denies for `.env.local`, `.env.development[.local]`, `.env.production.local`, `.env.staging[.local]`, `.env.test.local`, `**/.env.local`, `**/.env.*.local`, `**/.env.production` in `.claude/settings.json`; `.env.example` and `.env.test` stay writable |
| ADR-005 ratification | See "ADR-005 ratification review" below |

### ADR-005 ratification review (G0, 2026-11-10)

Two isolated Claude reviewers with fresh context (a ratification review and an adversarial gap hunt), read-only, run as workflow `wf_ebdec6eb-881`. Each finding then went to its own isolated verifier told to refute it. Both reviewers: **ratify with amendments**. 15 findings; 5 refuted, 10 survived and are applied to `docs/adr/0005-confine-service-role-client.md`. The PO ruled on the three points that touched approved decisions (C50).

| # | Finding (survived refutation) | Disposition |
|---|---|---|
| F1 | Consequences put the test restructuring in V2-01a; roadmap P0-10/V2-01a run suites unchanged and V2-01 plan 01-01 rewires them | Applied (Consequences) |
| F2 / A-03 | Items 2–3 and the lint verification had no phase; V2-03 "0 imports outside the allow-list" cannot pass while `/api/v1` (until P1-37) and the cron dispatch path (until V2-04; the service-role importers are `lib/messaging/dispatcher.ts` and `lib/webhooks/outbox.ts`, not the `app/api/cron/**` routes themselves, corrected by the re-review) hold the service role; no disposition for current non-allow-listed sites | Applied (Phasing and transition). **PO (C50 a, e):** time-boxed exception register with the real modules; roadmap V2-03 acceptance amended |
| F3 / A-02 | `no-restricted-imports` on the factory alone is bypassable (direct `createClient` with the key, `SUPABASE_SERVICE_ROLE_KEY` via `lib/env.ts`, dynamic `import()`, importing `features/*/system.ts` from actions) | Applied (Decision 4 + Verification 4, bypass fixtures). **PO (C50 d):** `no-restricted-syntax` added, still ESLint only; C20 row amended |
| F4 / A-06 | Verification proved only SEC-01; no SEC-02 (in-tenant role bypass, actor spoofing) case; grep misses `tenantIdOverride`, `actorSession`, non-action modules; no enumerated action set | Applied (Decision 1 scope, Verification 1–3, tool-generated V2-01 inventory, P0-13 cited) |
| F5 | Context overstated exposure contrary to C31 (4 confirmed actions; `getPatient`/`getPatients` pending OI-6) | Applied (Context) |
| F7 | Factory module unnamed and the docs disagreed (roadmap `lib/supabase/system.ts` vs TARGET_ARCHITECTURE/BACKEND D2 `lib/db`); "every use is logged" untested and PHI-free not stated | Applied. **PO (C50 b):** `lib/supabase/system.ts`; TARGET_ARCHITECTURE §2 (diagram + boundary rule) and BACKEND D2 aligned; log unit test in Verification 4 |
| F9 | Roadmap V2-01 counts (16 + 4 modules) understate the code (19 `"use server"` + 17 non-action modules with override parameters) | Applied: inventory is generated by a tool at the V2-01 base commit (Phasing) |
| (F8 verifier) | `AUTH_REDESIGN.md` names `features/auth/service.ts` as allow-listed, which does not match `features/*/system.ts` | **PO (C50 c):** admin calls in `features/auth/system.ts`; AUTH_REDESIGN §3/§6 aligned |

Refuted (not applied): F6 system-actor argument (already in TARGET_ARCHITECTURE §7 item 1; belongs to the RPC-per-flow ADR at G2); F8 no rule for adding paths (`docs/adr/README.md` already requires a gate-accepted ADR; the ADR now cites it); A-01 `notifyPrescriptionIssued` (P0-01 already deletes it; now named in Decision 1 anyway); A-04 non-override request-path uses (the lint rule as scoped flags them and the roadmap already disposes of them; covered by the register and "no fallback" sentence); A-05 grep evidence (two of three examples were not `"use server"` modules).

**Ratification:** ADR-0005 as amended is ready for the PO's G0 sign-off; on sign-off its status becomes Accepted.

### G0 re-review of the amendments (2026-11-11)

Two further isolated reviewers (consistency; adversarial) checked the uncommitted amendment diff, workflow `wf_1b316c7e-5e7`. Both returned **fix required**. All findings below were checked against the repo before applying; none was rejected.

| # | Finding | Disposition |
|---|---|---|
| RR1 | C49 applied only to P0-07, V2-15, G0 and §17.1; the V2-00 block (objective, scope, expected changes, plan 00-02, acceptance, tests, evidence), §1 recommendation, §8 Secrets row, phase map, R15, effort table, next step and the ops record still required rotation in V2-00, so G0 could not pass its own acceptance | Applied: every listed site carries the C49 deferral; R15 mitigation = deferred to V2-15, interim risk PO-accepted; ops record header, scope and smoke check rewritten (test-project keys N/A) |
| RR2 | Register entry `app/api/cron/**` misses the real importers (`lib/messaging/dispatcher.ts` own factory, `lib/webhooks/outbox.ts`), which request-path actions call to enqueue; RLS on `webhook_delivery_queue`/`webhook_subscriptions` is owner/admin-only, so the user client cannot replace them | **PO (C50 e):** register `lib/messaging/dispatcher.ts`, `lib/webhooks/**`, `app/api/cron/**` until V2-04; request paths enqueue through a SECURITY DEFINER enqueue RPC deriving the tenant from `auth.uid()`. ADR Decision 3, Phasing; roadmap C50 and V2-03 acceptance |
| RR3 | `lib/jobs/**` may call `getSystemDb` yet anyone may import it (TARGET_ARCHITECTURE has services importing `lib/jobs` for enqueue) | Applied: `lib/jobs` split into an enqueue surface (no `getSystemDb`) and an internal part importable only from `app/api/jobs/**`; bypass fixture added (ADR Decision 2/4, Verification 4; TARGET_ARCHITECTURE §2) |
| RR4 | `/api/v1` register entry has no real time box (P1-37 is P2 under PO-16) | **PO (C50 f):** may remain past v2.0 only if the env schema forces it off in production with a 404 test; new §17.1 item |
| RR5 | Decision 1 / Verification 3 would ban legitimate target ids (referral target clinic, doctor ids, platform-admin tenant, `removeStaff` user id) | Applied: scoped to the *acting* principal; target ids allowed and authorised by RLS / `has_permission()`; AST rule names listed explicitly |
| RR6 | P1-34 still said `no-restricted-imports` only | Applied (P1-34 row) |
| RR7 | `/api/ready` uses the service role and has no home | **PO (C50 g):** RPC-only health probe in V2-03 (P1-15), bucket check dropped; allow-list not widened |
| RR8 | Client-creation import owners unnamed; tests/scripts carve-out only on the syntax rule | Applied: owners `lib/supabase/{system,server,client}.ts` and `middleware.ts`; `tests/**` and `scripts/**` excepted from both rules |
| RR9 | Verification 1 cannot pass for non-action inventory members (public-token route and inbound-webhook helpers) | Applied: V1 scoped to `"use server"` exports; non-action members verified by parameter removal + importer check |
| RR10 | C49 lists could be read as complete (omit Gemini, Google GenAI, Gupshup, Twilio) | Applied: P0-07, §17.1 and the ops record say "every other non-test-project secret found in `.env.example` or the code", with those names |
| RR11 | SECURITY_VERIFICATION_PLAN, TARGET_ARCHITECTURE §3, BACKEND B6/B8 still described `no-restricted-imports` only / `lib/supabase/admin` / "grep shows one factory" | Applied (C50 errata) |

**Ratification:** ADR-0005 as amended is ready for the PO's G0 sign-off; on sign-off its status becomes Accepted.

### G0 signed off (2026-11-11)

The PO signed off G0 by merging PR #1 (`v2/phase-00-preflight` → `feature/v2`, merge commit `4c28661`).
ADR-0005 is **Accepted**. Note: the fixes applied after the G0 re-review (RR1–RR11) were not given a further
isolated re-review; the PO accepted them at merge. V2-01a may start.

### AUTH-00 spike results (V2-01a, 2026-11-11)

Measured on an isolated local stack (CLI 2.120.0, GoTrue v2.197.0); full note:
`.planning/phases/01A-local-db-harness/01A-04-AUTH00-SPIKE.md`. Hosted-only items (CAPTCHA token-accepted
path and single-use, hosted session-delete privileges, require-current-password, log retention) are re-checked
in V2-03. AUTH_REDESIGN is **not** edited; these items need a PO ruling before V2-01 (AUTH-01/04a) and V2-03.

| # | AUTH_REDESIGN assumption | Measured | Needs |
|---|---|---|---|
| A00-1 | §4.1 hook caveat: tell `/otp`-signup from `/signup` by whether the user has a password | New-address `/otp` arrives at the Send Email hook as `signup`, identical to `/signup`; the payload has no password field and `/otp` users get a password hash anyway | PO ruling on the `/otp` mitigation (e.g. CAPTCHA-only, or block `/otp` at the gateway) |
| A00-2 | §4.1 mitigation 2: Before User Created identifies the originating endpoint | Payload is identical across `/signup`, `/otp`, invite and `generateLink`; `admin.createUser` does not fire the hook | Same ruling as A00-1 |
| A00-3 | §4.4: identical signup response for an existing email | Not identical: CLI defaults → 422 `user_already_exists`; with SMS confirmations on → 200 but `identities: []`, `role: ""` | PO ruling on account-enumeration stance |
| A00-4 | §7 rate-limit test: "(limit+1)th attempt → 429" | Password grant is governed by `token_refresh`; `/signup`, `/recover`, `/otp` by `sign_in_sign_ups`. The CLI stack enforces no per-IP limit (no `GOTRUE_RATE_LIMIT_HEADER`); when enabled the burst is ~30 regardless of the value | Redesign of the rate-limit test (note lists three options) |
| A00-5 | Require current password blocks or bounds password change in fresh-OTP sessions | No CLI config key; [side-run] OTP and recovery sessions are exempt at any age tested (≤772 s); a wrong `current_password` is ignored when the setting is off | Hosted check in V2-03; consider a server-side age bound |

Confirmed as designed: verifyOtp `type:'email'` for signup codes and `'recovery'` for recovery codes (6-digit,
single-use); CAPTCHA endpoint list matches C43; `/otp` creates users by default; the pre-account hijack is real
and the post-verify `updateUser` + `signOut({scope:'others'})` fix works; a `postgres`-owned SECURITY DEFINER
function can delete `auth.sessions` and that revokes refresh; `amr` carries per-method timestamps.

### V2-01 gate evidence (2026-11-12)
V2-01 Security containment verified at `60d8db0`: before (`1491899`) 71 files / 700 tests, after 86 files / 1128 tests,
two consecutive local runs, 0 skipped; all ten roadmap acceptance items met. Evidence (tool-generated):
`.planning/phases/01-security-containment/evidence/`; summary, decisions D1–D12 / R1–R17 / F1–F22 and five review
reports (round 2 adversarial failed on two Highs, closed and re-verified in round 3): `01-SUMMARY.md`,
`01-VERIFICATION.md`, `01-PLAN.md`, `reviews/`. ADR-0005 amendment A1 proposed. Decisions were taken by the agent as
CTO under PO delegation (2026-11-11) and await PO confirmation at the gate.

### V2-02 gate evidence (2026-11-13)
V2-02 CI & e2e foundations verified at `004a2f3`: PR lane (static, security, test, build, e2e) green in GitHub Actions;
Vitest 102 files / 1899 tests ×2 locally with 0 skipped; Playwright PR lane 122; guard canary proves an unguarded action
fails the P0-13 guard; M0 baseline committed. Required checks on `feature/v2` applied (ruleset `feature-v2-ci`). Two
defects found and fixed beyond scope: cross-tenant reference writes, and credentials able to reach a URL via a GET login
form. Evidence and reviews: `.planning/phases/02-ci-e2e-foundations/` (`02-SUMMARY.md`, `02-VERIFICATION.md`,
`evidence/`, `reviews/`). Decisions RL-1…23 / OA-1…6 by the agent as CTO under PO delegation, for PO confirmation.

### V2-03 gate evidence (2026-11-13) — awaiting PO gate
V2-03 Platform hygiene verified locally at `2e6f3c2`. Vitest ran twice locally: 162 files / 3465 tests, 0 skipped, 0
failed. The report gate passed with floor 3292 and 69 required security/acceptance specs. Playwright PR lane: 188
expected (10 KNOWN-BUG expected failures), 7 skipped by design, 0 unexpected, 0 retried. The ESLint census reports
1 service-role factory and 0 boundary or UTC-today messages. Local drift passed (pg_net only). Typecheck, inventory,
AI-06 L1 and the audit gate are green. CI run link: recorded by the orchestrator in `03-VERIFICATION.md`
(`ci_run`).

Roadmap acceptance 2, 4, 5, 6 and 11 are met. 1, 3, 8, 10, 12 and 13 are met locally, with their hosted halves
pending PO. 7, 9 and 14 are code-complete and pending PO (03-E0…E11, post-merge, R-19).

Six isolated reviews found 4 distinct Highs (H-AUTH, H-ENV, H-LOG, H-PAY). All were fixed in 03-13a…e with regression
tests, and a fresh re-verification found them CLOSED. H-AUTH on hosted needs 03-E3 (access-token hook). The
re-verify's one Low was fixed at close.

Evidence, reviews and triage: `.planning/phases/03-platform-hygiene/` (`03-SUMMARY.md`, `03-VERIFICATION.md`,
`03-13-REVIEW-TRIAGE.md`, `evidence/`, `reviews/`). Rulings A00-1…5, R-1…R-36 and R-K were taken by the agent as CTO
under PO delegation. Doc errata (R-24) are proposed in `03-SUMMARY.md`, not applied. Merge waits on 03-E13 (rulings,
incl. R-9, R-35, R-36 and the proposed CLAUDE.md change), 03-E14 (two flagged packages) and 03-E15 (Next 16 outcome).

### G2-D design sign-off (2026-11-13)

| Item | Result | Evidence |
|---|---|---|
| V2-DX direction | **Approved by the PO**: direction A "Calm Confidence — Botanical Teal", typeface Inter, round-3 component system and consult structure; kept tokenised for later change | PR #7, branch `v2/phase-dx-design-exploration` at `e95b8b5`; `.planning/sketches/V2-DX-PROPOSAL.md` (round 3 + PO decision); evidence `.planning/sketches/v2-dx-evidence/` (axe 107 runs 0 serious/critical; contrast 139/139) |

### PO ruling: "CliniQ AI" is a fixed brand name (2026-11-14)

| Item | Ruling | Evidence |
|---|---|---|
| Product name vs AI-06 L1 copy rules (AI_STRATEGY §5.3) | The exact, case-sensitive string "CliniQ AI" is the brand name, not an AI feature claim: masked before L1-R5 (AI in UI copy) and L1-R6 (AI next to a price). Every other "AI" stays checked; AI features keep the AI-02 labels; pricing copy names the plan. Brand theme from Claude Design applied to the V2-DX branch (`d2e399f`) and supersedes the round-3 teal default for G2-D. | `scripts/ci/ai-l1-greps.mjs` (`BRAND_NAME`), `tests/ci/ai-l1-greps.spec.ts` (2 new cases, both fail on the old checker), fixtures `lint-fixtures/ai-l1/brand-name-*` |
