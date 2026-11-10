# clinicOS v2.0 — Security Assessment (Workstream D)

| | |
|---|---|
| Date | 2026-11-10 |
| Branch reviewed | `feature/v2` (HEAD `a6373b4`) |
| Method | Static / manual code review only (source, migrations, config, git history pattern scan). No DAST, no connection to the hosted Supabase project, MSG91 or AI providers. No secret values reproduced. |
| Companion docs | `THREAT_MODEL.md`, `DATA_HANDLING.md`, `SECURITY_REMEDIATION_PLAN.md`, `SECURITY_VERIFICATION_PLAN.md` |
| Status | **Not production-ready.** Three Critical and six High findings, including unauthenticated cross-tenant access to patient data. |

Labels used: **Fact** (verified in code), **Problem**, **Risk**, **Assumption (validate)**, **Recommendation**. Confidence levels: *Confirmed by code reading*, *Likely*, *Needs dynamic verification*. Priorities: P0 (release blocker / fix immediately), P1 (essential for v2), P2 (important), P3 (optional).

---

## 1. Executive summary

clinicOS has sound building blocks: RLS is enabled on all 43 tables, the API key design hashes keys with SHA-256 and uses constant-time compare, the outbound webhook signer follows Stripe's model, invitations store only token hashes, `getUser()` (not `getSession()`) is used server-side, there is no `dangerouslySetInnerHTML`, audit metadata is allow-listed, and there is an SSRF guard. The v1 team clearly cared about security.

That care is undone by a few systemic defects:

1. **Test seams became production backdoors (SEC-01, SEC-02).** About 80 exported Server Actions take optional `clientOverride` / `sessionOverride` parameters so tests can inject a session. Server Actions are public HTTP endpoints, and these parameters are ordinary serialisable arguments. Anyone who sends `sessionOverride = {tenantId, userId}` skips authentication and the role check. In six actions that are reachable from the browser, the same parameter also switches to the **service-role client**, which bypasses RLS. Result: **unauthenticated read of any clinic's patient list and unauthenticated writes to any clinic's profile and consent records**, given a tenant UUID. Tenant UUIDs are not secret: they appear in every signed storage URL shared with patients.
2. **The database lets users promote themselves (SEC-03).** The `memberships` UPDATE policy lets any member update their own row, and no column guard exists. A receptionist can set their own `role` to `owner` with one PostgREST call using the anon key and their session.
3. **The inbound messaging webhook has no authentication for the `dev` provider or any unknown provider name (SEC-04).** It runs in production with the service role. It finds appointments across all tenants by a partial phone match, so an unauthenticated caller can confirm, cancel or reschedule any patient's appointment and learn appointment IDs.
4. **Public share-link resolvers trust a row that any tenant member can write (SEC-05).** Any member can insert a token that points at another clinic's prescription, invoice, referral or document. The service-role resolver then serves that resource.
5. **RLS isolates tenants only, not roles (SEC-06).** Inside a clinic, every role can read and write every clinical table directly. This bypasses the application's permission matrix, the immutability of signed records, and the audit trail.

The cross-tenant RLS tests (`tests/security/cross-tenant.spec.ts`) pass because they check direct table access between two normal users. They do not cover the Server Action seam, the webhook, the token resolvers or role escalation inside a tenant.

**Recommendation:** treat SEC-01, SEC-03, SEC-04, SEC-05 and SEC-24 as a **P0 hotfix on v1 now**, before v2 work starts, if v1 is live with real patient data. Section 6 states what that means for incident handling (CERT-In / DPDP breach assessment).

### Severity summary

| Severity | Count | IDs |
|---|---|---|
| Critical | 3 | SEC-01, SEC-03, SEC-04 |
| High | 6 | SEC-02, SEC-05, SEC-06, SEC-07, SEC-24, SEC-25 |
| Medium | 14 | SEC-08 – SEC-11, SEC-13 – SEC-16, SEC-18, SEC-19, SEC-26, SEC-29, SEC-30, SEC-33 |
| Low | 7 | SEC-12, SEC-17, SEC-20 – SEC-23, SEC-27 |
| Info | 2 | SEC-28, SEC-32 |

(ID SEC-31 is unused. It was merged into SEC-06 during review.)

---

## 2. Scope and method

**In scope (reviewed):** `middleware.ts`; `lib/supabase/*`; `lib/auth/*`; `lib/permissions/*`; `lib/api/*`; `lib/webhooks/*`; `lib/messaging/*`; `lib/ai/*`; `lib/storage/*`; `lib/audit/*`; all 25 `"use server"` modules under `features/` and `app/`; all 29 `route.ts` handlers; public pages `app/r`, `app/reschedule`, `app/reports`; all 18 migrations (RLS, SECURITY DEFINER functions, storage policies); `next.config.ts`; `.env.example`; `supabase/config.toml`; `.gitignore`; git history (pattern scan); `package.json`.

**Tools run:** grep/ripgrep over the source; a git-history regex scan for key patterns (only file and commit were recorded); a comparison of the table list against RLS enablement. `npm audit` did not return within the timeout, so dependency results come from the coordinator's brief (§ SEC-24).

**Not done (Outstanding investigations):**
- OI-1: Hosted Supabase configuration: Auth rate limits, OTP expiry, refresh-token rotation and reuse detection, session time-box, MFA availability, project region, plan / PITR, storage bucket settings, and whether any triggers or policies exist out-of-band that are not in the migrations.
- OI-2: Vercel project configuration: env vars per environment (especially `NODE_ENV`, `MESSAGING_PROVIDER`, `CRON_SECRET`, `MSG91_WEBHOOK_SECRET`), log retention, deployment protection, and preview-deployment access.
- OI-3: Whether the hosted project used by tests is production (brief §established facts).
- OI-4: Whether v1 is live with real patients and whether any of SEC-01/03/04/05 has been exploited. Answering this needs a log review and `audit_logs` forensics on the hosted project, done by the owner.
- OI-5: Dynamic confirmation of Server Action ID discoverability and argument injection on a **local** build (see `SECURITY_VERIFICATION_PLAN.md` §5).

---

## 3. Architecture facts relevant to security

- **Fact:** There are three DB access modes. (1) The user-scoped SSR client (anon key + cookie JWT) is bound by RLS. (2) The service-role client from `getAdminClient()` (`lib/supabase/admin.ts:13`) bypasses RLS. (3) Ad-hoc service-role clients are created inline in `features/appointments/actions.ts:14-19`, `lib/messaging/dispatcher.ts:38-43` and `lib/storage/supabase-provider.ts:35-42`. The inline clients are used **whenever the key is present**, so in production every call through `getAppointmentsDbClient` / `getDbClient` runs as service role.
- **Fact:** Server-side authZ goes through `requirePermission()` (`lib/permissions/guards.ts:16`), which calls `getActiveMembership()` (`lib/auth/tenant.ts:30`) and derives the tenant from the DB membership. The design is correct, but many actions bypass it (SEC-01/02).
- **Fact:** `middleware.ts` refreshes the session only. It does not gate routes, which is acceptable because `app/(dashboard)/layout.tsx:13-19` and each handler check auth. It skips `/api/v1`, `/api/health` and `/api/ready`.
- **Fact:** Login uses Supabase email OTP (`app/(auth)/login/page.tsx:106`, `features/auth/dev-actions.ts:57-62`). MSG91 is used for patient messaging only, not for staff OTP. There is no password and no MFA.
- **Fact:** The public API `/api/v1/*` uses Bearer `clq_live_…` keys. The keys are stored as SHA-256 hashes and every key has all-or-nothing admin scope (`lib/api/auth.ts:13, 74-102`). The v1 routes consistently filter on `session.tenantId`. This was reviewed in all 14 handlers and no tenant-scoping gap was found.

---

## 4. Findings

Each finding lists: Severity · Priority · Confidence · Affected component · Evidence · Impact · Remediation · Verification.

### SEC-01 — Server Actions accept a client-supplied `sessionOverride` that bypasses authentication, and in six actions also switches to the service-role client

> Verification (2026-11-10): PARTIALLY_CONFIRMED — SEC-01: only 4 actions are confirmed browser-reachable (`searchPatients`, `updateClinicSettings`, `updateStatutorySettings`, `toggleGlobalConsent`); `getPatient` is imported only by a server page and `getPatients` has no importer, so their exposure is pending OI-6. Severity stays Critical/P0. See VERIFICATION_LOG.md

- **Severity:** Critical · **Priority:** P0 · **Confidence:** Confirmed by code reading (exploit path: Needs dynamic verification on a local build)
- **Component:** Server Actions in `features/patients/actions.ts`, `features/settings/actions.ts`, `features/patients/consent.ts`
- **Evidence:**
  - `features/patients/actions.ts:247-262` (`searchPatients`): `supabase = clientOverride || (sessionOverride ? getAdminClient() : …)`; `session = sessionOverride || await requirePermission(...)`, then `.eq("tenant_id", session.tenantId)`. Same pattern in `getPatient` `:168-176` and `getPatients` `:274-279`.
  - `features/settings/actions.ts:28-31, 48-51` (`updateClinicSettings`) and `:159-182` (`updateStatutorySettings`): service-role update of `tenants` where `id = sessionOverride.tenantId`, plus the `memberships` row for `sessionOverride.userId`. Returns `select("*")` of the tenant.
  - `features/patients/consent.ts:156-166` (`toggleGlobalConsent`): service-role insert of consent records with attacker-chosen `tenant_id` / `recorded_by`.
  - These actions are imported into client components, so their action IDs are shipped to the browser: `components/layout/global-search-modal.tsx:6`, `components/calendar/booking-drawer.tsx:9`, `components/settings/clinic-profile-form.tsx:6`, `components/settings/statutory-fields-card.tsx:5`, `app/(dashboard)/patients/[id]/consent-section.tsx:4`.
  - Tenant UUIDs are not secret. Storage paths start with the tenant UUID (`features/prescriptions/pdf/generator.ts:91`, `features/labs/actions.ts:102`), and signed URLs containing those paths are returned to patients by `app/api/r/[token]/route.ts:220-235`. In-network referrals require typing another clinic's tenant ID (`components/referrals/create-referral-modal.tsx:155`).
- **Impact:** An unauthenticated attacker who knows a clinic's tenant UUID can search and dump that clinic's patients (name, phone, DOB, address, ABHA ID, allergies, chronic conditions; 25 rows per query, repeatable). They can also overwrite clinic statutory registration numbers, rename the clinic, change a member's name/phone/registration number, and forge DPDP consent/withdrawal records. This breaks tenant isolation and confidentiality of health data. It would likely be a reportable personal-data breach (see `DATA_HANDLING.md` §8).
- **Remediation:** Remove `clientOverride` / `sessionOverride` / `tenantIdOverride` / `actorSession` from **every** exported function in a `"use server"` module. Move the business logic into non-exported service functions (`features/<x>/service.ts`, marked `import "server-only"`) that take an explicit, server-derived context. Keep the exported actions as thin wrappers that always call `requirePermission()`. Tests call the service functions directly. Add an ESLint rule / CI grep that fails when an exported action parameter is named `*Override` or typed as `SupabaseClient`. Never pick the service-role client based on a caller-provided argument.
- **Verification:** On a local Supabase plus a local `next build && next start`, take the action ID for `searchPatients` from the client bundle. POST it with `sessionOverride` set to a second local tenant's ID and no cookies, and expect it to be rejected. Add a unit test that every exported server action has an arity and parameter types without override parameters (AST check). See `SECURITY_VERIFICATION_PLAN.md` TC-SA-01..06.

### SEC-02 — `sessionOverride` on about 80 other Server Actions bypasses role checks and lets the caller spoof the acting user (RLS-bound)

> Verification (2026-11-10): PARTIALLY_CONFIRMED — SEC-02: 83 parameters; role checks bypassed and `signed_by`/`recorded_by`/`created_by`/audit `actor_id` spoofable within the tenant; `completeAndSignConsultation` reachable only via `completeAndBillConsultation`; `updateStaffMember` RLS-limited to the caller's own row. H/P0 (same fix as SEC-01). See VERIFICATION_LOG.md

- **Severity:** High · **Priority:** P0 (fixed together with SEC-01) · **Confidence:** Confirmed by code reading
- **Component:** Every action in `features/{visits,queue,waitlist,labs,referrals,consultation,prescriptions,billing,terminology,notifications,staff}/…` and `features/visits/scheduling.ts`
- **Evidence:** e.g. `features/consultation/actions.ts:597-603` (`completeAndSignConsultation`), `features/settings/actions.ts:338-361` (`updateStaffMember` — `requirePermission(…"clinic:manage")` is skipped), `features/billing/actions.ts:184-187` (`recordPayment`), `features/labs/actions.ts:388-397` (`deleteLabDocument`). These use the cookie client, so RLS still limits data to the caller's own tenants. The role check and the actor identity, however, come from the caller.
- **Impact:** Any authenticated member can perform actions their role does not allow. A receptionist can sign consultations and prescriptions, delete lab documents, edit staff, or change **their own role to owner** through `updateStaffMember`, because RLS allows self-update (SEC-03). The caller can also attribute `created_by`, `signed_by`, `recorded_by` and audit `actor_id` to any colleague. This destroys non-repudiation of clinical signatures, which matters medico-legally for e-prescriptions.
- **Remediation:** Same as SEC-01. In addition, take `signed_by` / `created_by` from `auth.uid()` in the database (column default or trigger), not from application input.
- **Verification:** Run the authZ matrix in `SECURITY_VERIFICATION_PLAN.md` §6 with a receptionist session that calls each doctor-only action with and without the override argument.

### SEC-03 — Privilege escalation: members can change their own `memberships.role` (RLS UPDATE policy has no column guard)
- **Severity:** Critical · **Priority:** P0 · **Confidence:** Confirmed by code reading (Needs dynamic verification on local DB)
- **Component:** `public.memberships` RLS
- **Evidence:** `supabase/migrations/000011_fix_memberships_rls_recursion.sql:26-39`. USING allows `user_id = auth.uid()`, and WITH CHECK only requires `tenant_id IN current_user_tenant_ids()`. The table has no column-level GRANT/REVOKE and no trigger protecting `role`; a search of all migrations found none. The anon key and the user's JWT are both available in the browser (`lib/supabase/client.ts:5-9`).
- **Impact:** Any staff member (receptionist, nurse) can run `PATCH /rest/v1/memberships?id=eq.<own>` with `{"role":"owner"}` and get full owner rights: billing, API keys, webhooks (exfiltration to an attacker URL), audit-log read, staff management. They can also set their `medical_council_reg_no` / `signature_url` and impersonate a doctor on prescriptions. Owners/admins can likewise demote other owners directly, bypassing the "last owner" guard in `features/settings/actions.ts:377-391`.
- **Remediation:** Replace the policy. Self-update is limited to profile columns, enforced by `REVOKE UPDATE ON memberships FROM authenticated; GRANT UPDATE (full_name, phone, qualifications, default_specialty, availability_schedule, default_slot_duration_minutes) ON memberships TO authenticated;`, or by a `BEFORE UPDATE` trigger that rejects changes to `role`, `tenant_id`, `user_id` and `medical_council_reg_no` unless the caller is owner. Move role changes into a `SECURITY DEFINER` RPC `change_member_role(p_membership_id, p_role)` that enforces "only owner can grant owner/admin" and "never remove the last owner".
- **Verification:** pgTAP / Vitest against **local** Supabase: as receptionist, self-update of `role` must be rejected (0 rows or error), while self-update of `full_name` must succeed. As admin, granting `owner` must fail. See TC-RLS-MEM-01..05.

### SEC-04 — Inbound messaging webhook: `dev` and unknown providers are unauthenticated in production; cross-tenant appointment manipulation by partial phone number
- **Severity:** Critical · **Priority:** P0 · **Confidence:** Confirmed by code reading
- **Component:** `app/api/webhooks/messaging/[provider]/route.ts`, `lib/messaging/webhook-helpers.ts`, `features/appointments/actions.ts`
- **Evidence:**
  - `lib/messaging/webhook-helpers.ts:35-36`: `if (provider === "dev") return true;` (no environment gate). `:85`: any other provider name falls through to `return true`. `:39-47` (twilio): the presence of any `x-twilio-signature` header returns `true` and no HMAC is computed.
  - The route accepts GET and POST (`route.ts:510-524`). For non-msg91 providers it takes `from` and `action` from query parameters (`route.ts:212-247`).
  - `route.ts:30` uses `getAppointmentsDbClient()`, which is service role in production (`features/appointments/actions.ts:14-19`).
  - `findActiveAppointmentByPhone` (`features/appointments/actions.ts:343-357`) searches **all tenants** with `ilike('phone', '%<last10>%')`. A short `from` such as `"98"` matches many patients.
  - Branches confirm (`route.ts:344`), cancel (`:394`) and reschedule (`:437-474`) mutate the visit. The reschedule branch **returns `reschedule_url` (bearer token) in the HTTP response** (`:473`). Responses include `appointment_id`.
  - The `replyMsgId` value is interpolated into a PostgREST `.or()` filter (`route.ts:295`).
- **Impact:** Unauthenticated, internet-wide ability to confirm or cancel real patients' appointments in any clinic, to enumerate appointment IDs, and (if the reschedule token insert succeeds, see SEC-32) to obtain reschedule links. Those links reveal patient name, phone, doctor and clinic, and allow moving the appointment. Attacker-controlled text is also injected into the receptionist notification feed (`route.ts:478-488`), which enables social engineering. This affects availability and integrity of clinical scheduling and exposes PII.
- **Remediation:** Delete the `dev`, `twilio` and `gupshup` branches from the production route, or gate them behind `NODE_ENV !== "production" && ALLOW_DEV_WEBHOOKS === "1"`. Default-deny unknown providers. For MSG91, verify with `crypto.timingSafeEqual` against a secret sent **only in a header**, add an IP allow-list if MSG91 publishes egress IPs, and add replay protection (event ID dedupe table). Route inbound replies **only** by `replyMsgId` → `communication_queue` → `(tenant_id, appointment_id)`. Remove the cross-tenant phone fallback, or restrict it to an exact E.164 match plus tenant resolution through the WhatsApp number the message was sent to. Never return tokens in webhook responses. Use `.eq()` instead of string-built `.or()`.
- **Verification:** Unit tests: `verifyWebhookSignature("dev", …)` must return false when `NODE_ENV=production`; an unknown provider must return false. Integration test against local DB: a GET `/api/webhooks/messaging/dev?from=98&action=btn_cancel` must return 403 and leave no visit changed. See TC-WH-01..07.

### SEC-05 — Public token resolvers do not bind the resource to the token's tenant or type; tokens are writable by any tenant member

> Verification (2026-11-10): PARTIALLY_CONFIRMED — SEC-05: lab documents, prescription PDFs and patient names leak; invoice PDFs do not (path is tenant-scoped); referral PDFs only if a path is set; attacker needs the victim's resource UUID. H/P0. See VERIFICATION_LOG.md

- **Severity:** High · **Priority:** P0 · **Confidence:** Confirmed by code reading
- **Component:** `app/api/r/[token]/route.ts`, `app/r/[token]/page.tsx`, `app/api/reschedule/[token]/route.ts`, `app/reschedule/[token]/page.tsx`, `app/api/reports/view/route.ts`, `app/reports/view/page.tsx`; table `document_share_tokens`
- **Evidence:**
  - RLS `doc_tokens_staff_manage` is `FOR ALL` with only a tenant check (`supabase/migrations/000013_labs_and_referrals.sql:144-154`). Any member, including a member of a free self-signup clinic, can insert a token row with their own `tenant_id` but **another tenant's** `resource_id` / `document_id`. FKs only check that the row exists.
  - The resolvers look up resources by ID with the service role and **no `tenant_id` filter**: `app/api/r/[token]/route.ts:71-74, 93-96, 115-118, 137-140`; `app/r/[token]/page.tsx:100-103`; `app/api/reschedule/[token]/route.ts:53-56`.
  - Reschedule GET/POST do not check `resource_type` (`app/api/reschedule/[token]/route.ts:25-49, 188-212`). Reschedule tokens are inserted with `resource_type: "referral"` (`features/appointments/actions.ts:403`), which causes type confusion with `/r/`.
- **Impact:** A malicious clinic user who obtains a victim resource UUID can get a signed URL for another clinic's prescription PDF, lab report, invoice or referral letter, or reschedule another clinic's appointment. UUIDs leak through shared links, webhooks and exports. This is cross-tenant PHI disclosure.
- **Remediation:** (1) Create tokens only through a `SECURITY DEFINER` RPC that verifies the resource belongs to the caller's tenant, and remove the INSERT/UPDATE policies for `authenticated` (keep SELECT for listing, or none). (2) In every resolver, add `.eq("tenant_id", shareToken.tenant_id)` and check `resource_type` against an allow-list per route. (3) Store only `sha256(token)` and compare by hash. (4) Add a dedicated `appointment_reschedule` resource type. (5) Make tokens single-purpose and set `max_access_count`.
- **Verification:** Integration test on local DB. As tenant A, insert a token row pointing at tenant B's prescription: the insert must be rejected, and if the row is seeded by service role, the resolver must return 404. Check that a prescription token sent to `/api/reschedule/<token>` returns 404/400. See TC-TOK-01..06.

### SEC-06 — RLS isolates tenants but not roles; clinical-record immutability and audit integrity are not enforced in the database

> Verification (2026-11-10): PARTIALLY_CONFIRMED — SEC-06: confirmed, except `payments` has no UPDATE policy (members can INSERT, not UPDATE). H/P1 (ruling C13). See VERIFICATION_LOG.md

- **Severity:** High · **Priority:** P1 · **Confidence:** Confirmed by code reading
- **Component:** RLS on `patients`, `visits`, `prescriptions`, `prescription_items`, `consultation_diagnoses`, `audit_logs`, `communication_queue`, `tenant_messaging_config`, `in_app_notifications`, `invoices`, `payments` and others
- **Evidence:**
  - `000003_patients_audit_consent.sql:64-85` (patients: any member can select, insert and update); `:91-97` (`audit_logs` insert checks only the tenant, not `actor_id = auth.uid()`).
  - `000007_consultation_prescriptions_cdci.sql:388-399` (prescriptions: any member can update, including signed rows); `000006…:116-121` (visits); `000009…:96-128` (invoices and payments: any member can update).
  - `000014_communications_and_ai.sql:45-54` (communication_queue `FOR ALL`); `:80-89` (tenant_messaging_config `FOR ALL`: any member can raise `monthly_quota`); `:117-126` (in_app_notifications: any member can read every user's notifications).
  - The app-layer role matrix (`lib/permissions/matrix.ts:25-75`) withholds `consultations:view` / `prescriptions:view` from receptionists, but the DB allows both.
- **Impact:** Staff can bypass every app-level restriction with their own JWT: read clinical notes they should not see, alter signed prescriptions or invoices after the fact, forge audit entries attributed to another user, inject arbitrary outbound WhatsApp/SMS to any phone at the clinic's expense (the dispatcher sends with service role), and disable quota governance. This undermines the DPDP "reasonable security safeguards" and the integrity of medical records.
- **Remediation:** Add a role-aware helper, `current_user_role(tenant_id)` (SECURITY DEFINER, `search_path` pinned). Express clinical-table policies per role, mirroring the permission matrix. Make `audit_logs` insertable only through a SECURITY DEFINER function that stamps `actor_id = auth.uid()` and the role. Add `BEFORE UPDATE/DELETE` triggers that reject changes to signed visits and prescriptions (`signed_at IS NOT NULL`) except through the amendment RPC, which writes `visit_revisions`. Revoke direct writes on `communication_queue` and `tenant_messaging_config` from `authenticated` and write only from server code. Restrict `in_app_notifications` SELECT to `recipient_user_id = auth.uid() OR recipient_role = current_user_role(tenant_id)`.
- **Verification:** A generated RLS matrix test, roles × tables × CRUD, against local Supabase (TC-RLS-ROLE-*). Trigger tests asserting that an update of a signed prescription fails.

### SEC-07 — No staff offboarding: memberships cannot be removed or deactivated; API keys outlive their creator
- **Severity:** High · **Priority:** P1 · **Confidence:** Confirmed by code reading
- **Component:** `memberships`, `api_keys`, staff management UI
- **Evidence:** `memberships` has no DELETE policy (`000001_foundation.sql:74-75`) and the code never deletes or deactivates a membership (search of `features/`, `app/`). The role enum has no "disabled" state (`000001:17`). API keys authenticate as `created_by` with no check that the creator is still a member (`lib/api/auth.ts:142-150`). Invitations cannot be revoked. Sign-out is local only (`components/layout/user-dropdown.tsx:24`).
- **Impact:** A former employee keeps full access to patient records indefinitely. This is a common real-world breach vector in small clinics, where staff turnover is high.
- **Remediation:** Add a `status` column (`active`/`suspended`/`removed`) to memberships. `current_user_tenant_ids()` should return active memberships only. Add an owner/admin "Remove staff" action that also revokes API keys created by the user, revokes pending invitations, and calls `auth.admin.signOut(userId, 'global')`. Add an invitation revoke action.
- **Verification:** Test: after removal, the user's existing JWT can read 0 rows (once the access token expires, or immediately if session revocation is used), their API keys return 401, and their pending invites fail to consume.

### SEC-08 — Admin-to-owner escalation and invitation abuse

> Verification (2026-11-10): PARTIALLY_CONFIRMED — SEC-08: all parts confirmed and understated: every role can self-promote via SEC-03. H/P0, fixed with SEC-03. See VERIFICATION_LOG.md

- **Severity:** Medium · **Priority:** P1 · **Confidence:** Confirmed by code reading
- **Evidence:** `features/settings/schema.ts:92` allows `role: "owner"` in staff edit, guarded only by `clinic:manage`, which admins hold. The invitation RLS insert (`000002_invitations_billing.sql:76-87`) plus the CHECK constraint (`:15`) allow an admin to insert an `owner` invite directly via PostgREST, even though the UI enum excludes owner (`features/staff/actions.ts:12`). `consume_invitation` (`000002:120-165`) does not bind the invite to `invited_address`, so anyone holding the link can join. In production the invite link is neither returned nor emailed (`features/staff/actions.ts:85-98`). This is a functional gap that pushes operators to share links insecurely.
- **Impact:** An admin can make themselves owner and remove the real owner. A leaked invite link lets an outsider join with the invited role.
- **Remediation:** Only owners may grant `owner`/`admin`, enforced in the RPC from SEC-03. Bind consumption to `auth.email() = invited_address`. Deliver invites by email through Supabase Auth `inviteUserByEmail` or a transactional mail provider. Shorten expiry to 72 hours.
- **Verification:** Admin attempts to grant owner via action and via PostgREST: both rejected. A different email consuming the token is rejected.

### SEC-09 — SECURITY DEFINER functions without tenant authorisation; invoice-number function executable by `anon`

> Verification (2026-11-10): PARTIALLY_CONFIRMED — SEC-09: missing membership check confirmed but leak is metadata-only; duplicate stored invoice numbers refuted by `UNIQUE(tenant_id, invoice_number)` (insert fails, `Date.now()` fallback instead); anon EXECUTE probably applies to all three functions (OI-5). M/P2. See VERIFICATION_LOG.md

- **Severity:** Medium · **Priority:** P1 · **Confidence:** Confirmed by code reading
- **Evidence:**
  - `search_medicines(p_query, p_doctor_id, p_tenant_id, …)` (`000007…:251-344`) is SECURITY DEFINER, executable by `authenticated`, and does not check that `p_tenant_id` is the caller's tenant, so it reads any doctor's custom formulary.
  - `generate_daily_queue_token(p_tenant_id, p_date)` (`000006…:76-96`) has no membership check, which leaks daily patient volume.
  - `generate_tenant_invoice_number(p_tenant_id)` (`000009…:63-83`) has **no REVOKE from PUBLIC/anon**, so anyone with the public anon key can call it. It leaks invoice counts. It also computes `count(*)+1` with no lock, which creates a duplicate-number race. GST invoices must have unique serial numbers.
  - All SECURITY DEFINER functions do pin `search_path` (good).
- **Impact:** Cross-tenant business-data leakage, and invoice-integrity problems.
- **Remediation:** Inside each function: `IF p_tenant_id NOT IN (SELECT current_user_tenant_ids()) THEN RAISE EXCEPTION …`, or derive the tenant from `auth.uid()`. `REVOKE EXECUTE … FROM PUBLIC, anon`. Use a per-tenant sequence table with `SELECT … FOR UPDATE`, or `INSERT … ON CONFLICT … RETURNING`, for invoice and queue numbers. Add a lint step (`supabase db lint` / splinter) to CI.
- **Verification:** Call each RPC as user A with tenant B's ID and expect an exception. Call `generate_tenant_invoice_number` with the anon key and expect permission denied.

### SEC-10 — Outbound webhook SSRF guard can be bypassed through redirects and DNS rebinding
- **Severity:** Medium · **Priority:** P2 · **Confidence:** Likely (Needs dynamic verification)
- **Evidence:** `lib/webhooks/dispatcher.ts:133-142` calls `fetch` with the default `redirect: "follow"`. The endpoint is validated by DNS lookup and then fetched separately (`ssrf.ts:150`), which is a TOCTOU window open to rebinding. `isPrivateIp` does not normalise expanded IPv6 forms (e.g. `0:0:0:0:0:0:0:1`) or NAT64 `64:ff9b::/96` (`ssrf.ts:48-73`). Delivery logs expose `response_status` and `duration_ms` to admins (`000018…:133-134`), which gives a blind-SSRF oracle.
- **Impact:** An owner/admin, or anyone who escalated via SEC-03, can probe internal services reachable from the serverless runtime. On Vercel the impact is limited (Assumption, validate).
- **Remediation:** `redirect: "manual"` and treat 3xx as failure. Resolve once and connect to the vetted IP (an undici `Agent` with a custom `lookup` that rejects private ranges). Normalise IPv6 with `ipaddr.js` and block every special-use range. Re-validate on every delivery (already done) and cap the response read.
- **Verification:** Unit tests with a mock DNS returning a private IP on the second lookup, with a 302 to `169.254.169.254`, and with an expanded-IPv6 loopback. All must be blocked.

### SEC-11 — Rate limiting is per-instance and in memory, and absent on public and auth surfaces
- **Severity:** Medium · **Priority:** P1 · **Confidence:** Confirmed by code reading
- **Evidence:** `lib/api/rate-limiter.ts:12` uses a module-level `Map`, which is reset per serverless instance and not shared. There is no limiter on `/api/r/*`, `/api/reschedule/*`, `/api/reports/view`, `/api/webhooks/*`, `/api/ai/*` (LLM cost), `requestOtpAction` (`features/auth/dev-actions.ts:20`; it relies only on Supabase Auth limits, see OI-1) or Server Actions in general.
- **Impact:** Enumeration and brute force are not throttled, AI cost can be abused (denial of wallet), and messaging quotas can be drained.
- **Remediation:** Use a shared limiter (Upstash Redis / Vercel KV, or a Postgres `rate_limits` table with `INSERT … ON CONFLICT` for low volume). Apply it in `middleware.ts` keyed by IP plus route class, and per user/tenant for AI and messaging. Add a per-tenant monthly AI budget.
- **Verification:** A load test against local/staging (k6) shows 429 after N requests regardless of instance count. Unit tests cover the limiter store.

### SEC-12 — API key model: no scopes, no expiry, non-atomic usage counters
- **Severity:** Low · **Priority:** P2 · **Confidence:** Confirmed
- **Evidence:** `lib/api/auth.ts:13` (`role: "admin"` for every key); no `expires_at` column (`000018…:5-16`); the read-then-write counter (`lib/api/auth.ts:113-137`) loses increments under concurrency. Good practice already present: SHA-256 hash, prefix display, single reveal (`components/settings/developer/single-reveal-key-modal.tsx`), constant-time compare.
- **Remediation:** Add `scopes text[]` (read:patients, write:appointments, …), optional `expires_at`, and IP allow-list. Use an RPC with `ON CONFLICT DO UPDATE SET request_count = request_count + 1`.
- **Verification:** A test showing that a key with read-only scope gets 403 on POST.

### SEC-13 — No security headers (CSP, HSTS, frame-ancestors, nosniff, Referrer-Policy, Permissions-Policy)

> Verification (2026-11-10): PARTIALLY_CONFIRMED — SEC-13: missing headers confirmed; Referer token leakage overstated (browser defaults, `noreferrer`); edge HSTS unverifiable (OI-8). M/P1. See VERIFICATION_LOG.md

- **Severity:** Medium · **Priority:** P1 · **Confidence:** Confirmed
- **Evidence:** `next.config.ts:3-5` has no `headers()`. `middleware.ts` sets none, and there is no `vercel.json`.
- **Impact:** The dashboard can be framed (clickjacking of actions such as consent toggles or signing). There is no XSS defence-in-depth. Token URLs leak through `Referer` to third-party resources on public pages.
- **Remediation:** Add headers in `next.config.ts`: `Content-Security-Policy` (nonce-based via middleware; `connect-src` limited to the Supabase URL), `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `X-Frame-Options: DENY` / `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` (at least on `/r`, `/reschedule`, `/reports`), `Permissions-Policy`, and `Cache-Control: no-store` on PHI pages.
- **Verification:** ZAP baseline against local or staging; check the headers in Playwright.

### SEC-14 — Dev/UAT authentication shortcuts depend only on `NODE_ENV`

> Verification (2026-11-10): PARTIALLY_CONFIRMED — SEC-14: code matches, but `next build`/`next start`/Vercel previews force `NODE_ENV=production`, so exposure is limited to reachable `next dev` servers holding a real service key. M/P1. See VERIFICATION_LOG.md

- **Severity:** Medium · **Priority:** P1 · **Confidence:** Confirmed (impact depends on deployment config, see OI-2)
- **Evidence:** `features/auth/dev-actions.ts:30-83`. When `NODE_ENV !== "production"` and the service key is set, `requestOtpAction` (a public Server Action used by `/login` and `/join`) generates a magic link and OTP for **any email** with the admin API and **returns them to the browser**. `features/staff/actions.ts:85-98` returns raw invite tokens in non-production.
- **Impact:** Any environment run with `next dev` or a non-production `NODE_ENV` (UAT, demo, preview) that has a real service key allows one-request account takeover of any user, including owners of real clinics if the environment points at the production DB (OI-3).
- **Remediation:** Remove dev OTP shortcuts from application code; use the Supabase local Inbucket/Mailpit for dev. If they are kept, gate them on an explicit `ENABLE_DEV_AUTH_SHORTCUTS=1` **and** a check that the Supabase URL is localhost, and fail closed.
- **Verification:** A unit test asserting the action never returns `devOtp` when the Supabase URL is not localhost. A CI check that production builds tree-shake the module.

### SEC-15 — Messaging defaults to a "dev logger" provider that writes patient phone numbers and message parameters to logs; local dev log files hold PII/OTPs

> Verification (2026-11-10): PARTIALLY_CONFIRMED — SEC-15: "webhook forces dev" is wrong (conditional on inbound provider); the unauthenticated `dev` webhook in production is real and merged into SEC-04 (P0); `.planning` logs were never committed. M/P1. See VERIFICATION_LOG.md

- **Severity:** Medium · **Priority:** P1 · **Confidence:** Confirmed
- **Evidence:** `lib/messaging/index.ts:20-31` defaults to `"dev"` when `MESSAGING_PROVIDER` is unset, or when `msg91` is selected without `MSG91_AUTH_KEY`, with no production gate. `lib/messaging/dev-logger.ts:60-90` logs recipient, template and parameters (patient name, doctor, document links containing bearer tokens) to `console.log` and appends to `.planning/dev-messages.txt`. The webhook forces the `dev` provider for replies (`route.ts:331, 379, 423, 463, 497`).
  - **Fact (local workstation):** `.planning/dev-messages.txt` (~191 KB, 225 recipient entries) and `.planning/dev-auth-logs.txt` (~8 KB, entries containing emails and OTP lines) exist. Both are git-ignored (`.gitignore:47-48`), and a history check found **no commit** touching either file. Contents were not copied or inspected beyond line counts. Whether they contain real people's data is **Assumption (validate)**.
- **Impact:** A misconfigured production environment silently stops sending messages and writes PHI and share tokens into platform logs (Vercel log drains, third-party log tools). The local files are PII at rest on a developer laptop.
- **Remediation:** Fail closed in production when no real provider is configured. Remove file writes from the app runtime. Redact phone numbers to the last 4 digits and drop template params in all logs. Owner action: securely delete both `.planning/dev-*.txt` files after confirming whether real data is present.
- **Verification:** A unit test that `getMessagingProvider()` throws in production without config. A grep CI rule banning `console.log` of `params` / `recipient`.

### SEC-16 — AI integrations: identifiable patient data sent to third-party LLMs; client-controlled conversation; scrubber not applied to free text

> Verification (2026-11-10): PARTIALLY_CONFIRMED — SEC-16: PII to LLM, unused scrubber and client-controlled conversation confirmed; `app_metadata` fallback is server-controlled (stale-role risk only) and each tool calls `assertRoleAllowed`; DPA is contractual (OI-9). M/P1. See VERIFICATION_LOG.md

- **Severity:** Medium · **Priority:** P1 · **Confidence:** Confirmed
- **Evidence:**
  - The operations copilot `search_patients` tool returns `full_name`, `phone`, `age`, `sex` and last visit, which are passed back to the LLM (`lib/ai/tools/operations-tools.ts:62-107`).
  - `stripPiiFromText` (`lib/ai/sanitizer.ts:45`) is never called in runtime code; the only callers are tests. SOAP shorthand and chat messages go to the provider as-is (`lib/ai/soap-generator.ts:65-90`, `app/api/ai/clinical-copilot/route.ts:51-56`). Structured context is minimised (`sanitizePatientContextForPrompt` keeps age, sex, vitals and conditions), which is good.
  - The full client-supplied `messages` array, including any `system`/`assistant`/`tool` roles, is forwarded (`app/api/ai/operations-copilot/route.ts:36-40, 74`). This allows prompt and tool-result injection.
  - Tenant and role fall back to `user.app_metadata` when membership resolution fails (`operations-copilot/route.ts:24-33`; `clinical-copilot/route.ts:25-31`).
  - The operations copilot has no permission check at the route level. Tools enforce roles (`assertRoleAllowed`), and mutating tools are **preview-only**: the booking is committed by the separately guarded `bookAppointment` action, which is a good human-in-the-loop design.
  - The provider is Gemini via AI Studio key or OpenAI (`lib/ai/client.ts:44-75`). No DPA, residency or zero-retention configuration is documented.
- **Impact:** Identifiable health data goes to a processor outside India without a documented contract, which creates DPDP processor-contract and cross-border exposure. Prompt injection could steer tool calls, which are bounded by the user's RLS scope and preview-only mutations, so the residual risk is mostly misleading output and data leakage into the provider.
- **Remediation:** Return opaque handles plus masked names (e.g. "R. K***, M, 42") from tools and resolve them client-side. Apply `stripPiiFromText` to all free text before it is sent. Accept only `user` messages from the client and rebuild assistant/tool turns server-side, or sign them. Remove the `app_metadata` fallback (fail closed). Require `consultations:edit` for clinical copilot and an AI feature flag per tenant. Use paid / enterprise endpoints with no-training and zero/limited retention terms, sign DPAs, and record the processors in a sub-processor list.
- **Verification:** Unit tests: tool output contains no phone numbers; injected `role: "system"` messages are dropped. Contract review (legal).

### SEC-17 — Open redirect in auth callback `next` parameter
- **Severity:** Low · **Priority:** P2 · **Confidence:** Likely (Needs dynamic verification)
- **Evidence:** `app/auth/callback/route.ts:9, 17, 28` builds `${origin}${next}` with an unvalidated `next`. A value such as `@evil.example` produces `https://app.host@evil.example`.
- **Remediation:** Allow only relative paths that match `^/[^/\\]` and are not protocol-relative, or use a fixed allow-list.
- **Verification:** A unit test with `next=@evil.example`, `//evil.example` and `/\evil.example` asserts a redirect to `/`.

### SEC-18 — Integrity of signed clinical documents: PDFs overwritten in place; no WORM or hash

> Verification (2026-11-10): PARTIALLY_CONFIRMED — SEC-18: confirmed for prescription and invoice PDFs; lab documents are uploads (not signed) but are also deletable by any member; "signed" means finalised, not cryptographic. M/P1. See VERIFICATION_LOG.md

- **Severity:** Medium · **Priority:** P1 · **Confidence:** Confirmed
- **Evidence:** `upsert: true` in `features/prescriptions/pdf/generator.ts:106`, `features/billing/pdf/generator.ts:78` and `features/labs/actions.ts:127`. Storage UPDATE policies let any member overwrite objects in the tenant prefix (`000008_prescriptions_storage.sql:45-54`, `000013…:53-69`). No content hash is stored on the prescription row.
- **Impact:** A signed e-prescription or lab report can be silently replaced, which weakens its medico-legal evidentiary value (IMC/NMC record-keeping; see `DATA_HANDLING.md` §7).
- **Remediation:** Write signed artefacts once (`upsert: false`) to a versioned path. Store a SHA-256 of the PDF on the row. Remove storage UPDATE/DELETE for `authenticated` on the `prescriptions` bucket and route deletion through a server action with audit. Consider object versioning or retention lock if R2/S3 is used.
- **Verification:** Test that re-generating a signed prescription creates a new object and leaves the old hash unchanged; a direct storage overwrite as a member must fail.

### SEC-19 — MSG91 webhook secret handling and replay; cross-tenant routing even for genuine messages

> Verification (2026-11-10): PARTIALLY_CONFIRMED — SEC-19: all true and impact understated: dev/unknown/Twilio branches make the route an unauthenticated control path; `replyMsgId` allows filter injection. Merged into SEC-04, H/P0. See VERIFICATION_LOG.md

- **Severity:** Medium · **Priority:** P1 · **Confidence:** Confirmed
- **Evidence:** `lib/messaging/webhook-helpers.ts:59-80` uses a plain `===` compare (not constant-time), accepts the secret in the `?secret=` query string (which ends up in access logs), accepts the MSG91 **auth key** itself as webhook credential, and has no timestamp/nonce (replays of DLR or "confirm" are possible). Genuine inbound replies without `replyMsgId` fall back to cross-tenant phone search (`route.ts:316-318`), so a patient registered at two clinics can affect the wrong clinic's appointment.
- **Remediation:** As SEC-04. Use a dedicated webhook secret (not the API auth key), compare it in constant time, accept it in a header only, and dedupe on `request_id`/event ID.
- **Verification:** Unit tests for the compare, the header-only rule and replay rejection.

### SEC-20 — PostgREST filter strings built from unvalidated input
- **Severity:** Low · **Priority:** P2 · **Confidence:** Confirmed (impact bounded)
- **Evidence:** `app/api/v1/visits/route.ts:67-79` (`start_date`/`end_date` from the query string); `app/api/webhooks/messaging/[provider]/route.ts:295` (`replyMsgId`); `features/patients/actions.ts:213-245` strips `,()` but not `.`/`:`. Other interpolations use server-derived values (`features/visits/actions.ts:144`, `features/queue/actions.ts:292`).
- **Impact:** Filter manipulation within the same tenant. The extra `.eq("tenant_id")` AND keeps scope (except the webhook, which runs as service role without a tenant filter and is covered by SEC-04).
- **Remediation:** Validate dates with zod (`z.string().datetime()` / `date()`) and IDs with `uuid()`. Prefer `.gte/.lte/.eq` chains over `.or()` strings, or escape with PostgREST double-quoting.
- **Verification:** Unit tests with payloads containing `,` `)` `.` `or(`.

### SEC-21 — Internal error messages returned to clients
- **Severity:** Low · **Priority:** P2 · **Confidence:** Confirmed
- **Evidence:** `lib/auth/tenant.ts:48`, `app/api/ai/operations-copilot/route.ts:85`, `app/api/reschedule/[token]/route.ts:284`, and most actions return `err.message`, which can include PostgREST/DB detail. `/api/v1` uses a sanitised envelope (good).
- **Remediation:** Map to generic messages plus a correlation ID; log details server-side with redaction.

### SEC-22 — Share-link hygiene
- **Severity:** Low · **Priority:** P2 · **Confidence:** Confirmed
- **Evidence:** Tokens have 256-bit entropy (`crypto.randomBytes(32)`), which is good, but they are stored in plaintext (`000013…:126`) and readable by all tenant members. They last 7 days with unlimited accesses. The token is passed in the query string at `/api/reports/view?token=` (`app/api/reports/view/route.ts:8`). The reschedule GET returns the patient phone (`app/api/reschedule/[token]/route.ts:148`). There is no rate limit (SEC-11) and no `Referrer-Policy` (SEC-13).
- **Remediation:** Hash tokens at rest, put the token in the path only, use 72-hour expiry for clinical documents, optional DOB/OTP challenge for clinical documents, mask the phone, `no-store` + `no-referrer`.

### SEC-23 — Upload validation and PII in object keys
- **Severity:** Low · **Priority:** P2 · **Confidence:** Confirmed
- **Evidence:** `features/labs/actions.ts:52-58` trusts the client-declared `file.type` and does no magic-byte check. The storage key includes the patient's full name (`features/labs/actions.ts:96-102`, `features/labs/utils.ts:9`). Server Action body limits are not configured (`next.config.ts`), so the 25 MB claim conflicts with the Next.js default limit (Assumption, validate).
- **Remediation:** Sniff magic bytes (e.g. `file-type`), use random object keys and keep the display filename in the DB, and set `serverActions.bodySizeLimit` explicitly. For large files consider signed upload URLs with server-issued keys under `tenants/<tenant>/…`.

### SEC-24 — Known-vulnerable dependencies (next, zod and others)
- **Severity:** High · **Priority:** P0 · **Confidence:** Confirmed (from coordinator's `npm audit --omit=dev`: 10 vulns, 9 high, 1 critical)
- **Evidence:** Installed `next` 15.5.27 and its bundled postcss, and `zod` 3.25.76 (advisory: memory exhaustion before the patched version). `@supabase/ssr` 0.5.2 is old. Ranges are in `package.json`.
- **Remediation:** Upgrade `next` to the latest patched 15.x/16.x, `zod` to the patched line, and `@supabase/ssr` to the current release. Enable Dependabot/Renovate and an `npm audit --audit-level=high` CI gate.
- **Verification:** `npm audit --omit=dev` shows zero high/critical; the full regression suite passes.

### SEC-25 — Test suite and seed scripts run against a hosted Supabase project with the service-role key from developer machines

> Verification (2026-11-10): PARTIALLY_CONFIRMED — SEC-25: tests do create real users/tenants; seed scripts only upsert reference catalogs; a local stack exists in `supabase/config.toml` but is unused; production status unverifiable (OI-1). H/P0. See VERIFICATION_LOG.md

- **Severity:** High · **Priority:** P0 (confirm) · **Confidence:** Needs verification (OI-3)
- **Evidence:** Brief: `tests/helpers/tenants.ts` creates real auth users and tenants using the service-role key against a hosted project; there is no local DB setup. `scripts/seed-*.ts`, `scripts/msg91-test-send.ts`.
- **Impact:** If that project is production, test runs create fake clinics and users in production, can mutate real data, and spread the most powerful credential to every laptop and CI runner. The `sessionOverride` seam (SEC-01) exists because of this test design.
- **Remediation:** Move to `supabase start` (local) or an ephemeral branch DB in CI. Rotate the service-role key and the Supabase access token after migration. Keep production keys only in Vercel and a secret manager.
- **Verification:** CI uses `SUPABASE_URL=http://127.0.0.1:54321`, and a grep confirms no hosted URL in test env files.

### SEC-26 — Authentication assurance: no MFA, OTP-only, session lifetime and revocation not defined
- **Severity:** Medium · **Priority:** P1 · **Confidence:** Confirmed (hosted config is OI-1)
- **Evidence:** There is no MFA code anywhere (search for `mfa|totp|aal`). `supabase/config.toml` sets `jwt_expiry = 3600` locally and nothing else (no refresh rotation or session time-box defined in the repo). Signup is open (`enable_signup = true`; `shouldCreateUser: true` at `features/auth/dev-actions.ts:61`). Account recovery is email-only: whoever controls the mailbox controls the account.
- **Impact:** Compromise of a doctor's or owner's email gives full PHI access. Shared clinic front-desk PCs keep long-lived sessions.
- **Remediation:** Offer TOTP MFA (Supabase MFA) and require it for owner/admin and for API-key/webhook management (check `aal2` in `requirePermission` for sensitive permissions). Configure an inactivity timeout (e.g. 12 h) and a time-box (e.g. 7 d), and enable refresh-token reuse detection. Add an "active sessions / sign out everywhere" control. Turn off auto-signup on `/login` and create users only through clinic creation or invite.
- **Verification:** A configuration review of the hosted Auth settings, and e2e tests that owner actions are blocked at `aal1`.

### SEC-27 — Unauthenticated readiness probe touches DB and storage; cron secret comparison
- **Severity:** Low · **Priority:** P3 · **Confidence:** Confirmed
- **Evidence:** `app/api/ready/route.ts:12-81` (3 service-role calls per request, no auth or rate limit). `app/api/cron/*/route.ts:8` uses a non-constant-time compare (low risk).
- **Remediation:** Protect `/api/ready` with a header secret or Vercel-only access; cache the result for 10 s; use `timingSafeEqual` for the cron secret.

### SEC-28 — Secret scanning result (informational)
- **Severity:** Info · **Confidence:** Confirmed
- **Evidence:** A git-history regex scan for JWT, Supabase PAT, Google API key, OpenAI key, AWS key, private key, `clq_live_` and `whsec_` patterns found **one** match: a syntactically valid but fake `clq_live_…` literal in `tests/api/v1-auth.spec.ts:100` (present in commits since it was added; most recent `a6373b4`). No Supabase, MSG91 or AI keys were found in history. `.env` is git-ignored and was never committed (brief). `.env.example` contains placeholders only. Only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_APP_URL` are public, which is appropriate.
- **Recommendation:** Run gitleaks with an allow-list for the test literal (see verification plan). Replace the literal with a generated value.

### SEC-29 — Audit trail gaps (read access, API reads, retention, tamper resistance)
- **Severity:** Medium · **Priority:** P1 · **Confidence:** Confirmed
- **Evidence:** Read events are logged only for the patient detail page (`features/patients/actions.ts:192-199`). Searches, consultation and history views, PDF previews, `/api/v1` GETs, AI copilot data access and share-link accesses (only a counter at `app/api/r/[token]/route.ts:161-166`) are not logged. Audit rows can be forged by members (SEC-06). The webhook writes `recipient_phone` straight into audit metadata, bypassing the allow-list (`route.ts:76-90`). No retention or export of audit logs is defined, while CERT-In asks for 180 days of ICT logs.
- **Remediation:** Log read access to clinical data (patient, visit, prescription, document, export) through one server-side helper. Add a SECURITY DEFINER audit-insert function (SEC-06). Add hash chaining (`prev_hash`) or periodic export to append-only storage. Define 180-day-plus retention for security logs, and longer for clinical access logs per legal advice.
- **Verification:** A test that each read endpoint produces an audit row; a forgery attempt fails.

### SEC-30 — DPDP erasure is a soft flag; no retention schedule or purge
- **Severity:** Medium · **Priority:** P1 · **Confidence:** Confirmed
- **Evidence:** `features/dpdp/erasure.ts:72-87` only sets `is_deleted/status/erased_at`, so name, phone, address and ABHA stay in clear. RLS still returns erased rows (`000003…:64-68`), and `getPatient(…, includeErased)` exists. Storage objects, `communication_queue` rows (phones and template params), notifications and AI logs are untouched. There is no purge job after the statutory retention period. Erasure is only reachable by API key (`app/api/v1/patients/[id]/route.ts:207-262`) and has no staff UI.
- **Remediation:** See `DATA_HANDLING.md` §5. Restrict access to erased records, pseudonymise contact fields that are not needed for the medical record, and schedule purge or anonymisation after the retention period (legal to confirm).

### SEC-32 — Reschedule token insert likely fails (FK to a non-existent user), error ignored
- **Severity:** Info (functional and integrity) · **Priority:** P2 · **Confidence:** Likely
- **Evidence:** `features/appointments/actions.ts:400-408` inserts `created_by: "00000000-0000-0000-0000-000000000000"`, but `document_share_tokens.created_by` is `NOT NULL REFERENCES auth.users(id)` (`000013…:131`). The insert result is not checked, so a dead link is still sent to the patient.
- **Remediation:** Use a real actor (or make the column nullable with `actor_type='system'`) and check the error.

### SEC-33 — In-network referrals: cross-tenant writes are unrestricted
- **Severity:** Medium · **Priority:** P2 · **Confidence:** Confirmed
- **Evidence:** Any tenant can create a referral targeting any `target_tenant_id` with arbitrary `consented_history_snapshot` / `clinical_summary` (`app/api/v1/referrals/route.ts:120-225`; RLS `000013…:207-216`). The receiving tenant's UPDATE policy (`000013…:231-242`) allows changing **any column**, including `clinical_summary`, `patient_id` and `tenant_id`, as long as `target_tenant_id` stays theirs. `createReferral` reads the patient without a tenant filter (`features/referrals/actions.ts:56-59`; RLS-bounded).
- **Impact:** Spam or phishing into other clinics' inboxes, and tampering with the referring clinic's clinical record. Sharing a patient's history with another fiduciary also needs a documented consent basis (DPDP).
- **Remediation:** Make the receiver able to update only `status`, `acknowledged_at`, `completed_at` and `closure_notes` (column grants or trigger). Allow targets only from an opt-in directory or a referral-connection table. Make the snapshot server-built only.

---

## 5. Positive controls observed (keep in v2)

- RLS enabled on all 43 tables, with a catalog-level inspection RPC (`000005_rls_inspection.sql`) and tests.
- `getUser()` used server-side, never `getSession()`; the tenant derived from the DB membership (`lib/auth/tenant.ts`), with explicit multi-clinic selection.
- API keys hashed (SHA-256), constant-time compare, single reveal; webhook secrets generated with a CSPRNG; HMAC-signed outbound webhooks with timestamp (`lib/webhooks/signer.ts`); SSRF guard with re-validation at dispatch.
- Invite tokens stored hashed; atomic `consume_invitation` with row lock and expiry.
- Audit metadata allow-list (`lib/audit/audit.ts:97-149`), so clinical content is kept out of audit logs.
- No `dangerouslySetInnerHTML`; React-PDF rendering (no HTML-to-PDF injection surface found).
- AI: structured patient context minimised; copilot mutations are preview-only with human confirmation; deterministic (non-LLM) prescription suggestions.
- `/api/v1` handlers consistently scope by `session.tenantId`, validate doctor assignment (`lib/api/doctor-guard.ts`) and use a sanitised error envelope.
- Private storage buckets with MIME and size limits and tenant-prefix policies.
- Messaging governance: opt-out, quiet hours and quota checks (`lib/messaging/governance.ts`).

---

## 6. Regulatory and compliance considerations

> **Disclaimer:** This is an engineering view to frame the work. It is **not legal advice and does not claim compliance**. Every item marked ⚖ requires validation by Indian counsel with health-data and DPDP expertise.

### 6.1 Classification of obligations

| Ref | Requirement | Type | Applies to | Current state | Gap / action |
|---|---|---|---|---|---|
| R1 | **DPDP Act 2023**: the clinic is the *Data Fiduciary* for patient data; clinicOS (the company) is the *Data Processor* for patient data, and the *Fiduciary* for staff account data and its own business data. ⚖ | Legal | Clinics and clinicOS | Not documented | Execute a Data Processing Agreement (DPA) with each clinic (ToS clause): processing only on instructions, security safeguards, breach notification to the clinic, sub-processor list, deletion at end of contract. ⚖ |
| R2 | DPDP s.8(5): reasonable security safeguards to prevent personal data breach. Rule 6 of the DPDP Rules 2025 lists minimum measures: encryption/obfuscation/masking, access control, **logs and monitoring, retention of logs (Rules indicate 1 year)**, backups and continuity, contractual flow-down to processors. ⚖ | Legal (fiduciary) → Contractual (processor) | Clinic, via clinicOS | Partial; SEC-01..07 are failures of this | P0/P1 fixes; log retention ≥ 1 year for access logs (Rules) and ≥ 180 days (CERT-In). ⚖ |
| R3 | DPDP s.8(6) and Rule 7: breach intimation to the Data Protection Board and to each affected Data Principal without delay; detailed report within 72 hours (Rules). The processor must inform the fiduciary promptly (contractual). ⚖ | Legal / Contractual | Clinic (to Board), clinicOS (to clinic) | No incident process | Incident response runbook (who, how, templates); per-tenant affected-patient lists from audit logs. If SEC-01/04/05 were exploited in v1, a breach assessment is required. ⚖ |
| R4 | DPDP s.6 and 7: consent, or "certain legitimate uses". Medical treatment and medical emergencies have specific legitimate-use grounds (s.7), so consent may not be the only basis for treatment records. Marketing/reminders need a clear basis. ⚖ | Legal | Clinic | Consent records exist (global/treatment/data_sharing) | Separate purposes: treatment (legitimate use), appointment communications, sharing with referral doctors, AI processing. Itemised notice (s.5) in English and the regional language (Marathi is already supported in templates). ⚖ |
| R5 | DPDP s.11-14: rights to access, correction/erasure, grievance redressal, nominee. | Legal | Clinic (fulfils); clinicOS provides tooling | Export (JSON/PDF) via API and UI; erasure via API only; no correction log, grievance or nominee | Staff UI for rights requests with SLA tracking; erasure that respects retention (R8). |
| R6 | DPDP s.9: processing of children's data needs verifiable parental consent; no tracking or behavioural monitoring. Pediatrics is supported. ⚖ | Legal | Clinic | Guardian fields exist; no verifiable consent workflow | Guardian consent capture for minors; exemptions for healthcare under the Rules to be checked. ⚖ |
| R7 | DPDP s.16: cross-border transfer is allowed except to countries the Government restricts (negative list). The Rules may impose conditions. ⚖ | Legal | clinicOS (processor), AI and messaging vendors | Supabase region unknown (OI-1); Gemini/OpenAI outside India | Document data locations; prefer an India region (Supabase `ap-south-1` Mumbai); AI vendor terms. |
| R8 | **Medical record retention.** IMC (Professional Conduct, Etiquette and Ethics) Regulations 2002 reg. 1.3.1: maintain indoor-patient records for 3 years. The NMC Registered Medical Practitioner (Professional Conduct) Regulations 2023 were notified and then held in abeyance; the 2002 regulations are generally treated as operative. ⚖ Clinical Establishments Act 2010 and state rules (e.g. Maharashtra) and state record-keeping norms may require longer periods. Medico-legal practice is often 7-10 years. ⚖ | Legal | Clinic | The code cites "NMC 1.3.1, 3-year" (`features/dpdp/erasure.ts:90`) as if settled | Configurable per-tenant retention policy; legal to set defaults per state. DPDP s.8(7) erasure yields to retention required by other law (s.8(7)/s.17 interplay). ⚖ |
| R9 | **E-prescriptions:** IMC 1.4.2 (registration number displayed), Drugs and Cosmetics Rules 1945 r.65 / Schedule H/H1/X requirements, Telemedicine Practice Guidelines 2020 (prescription format; **telemedicine itself is out of scope**). ⚖ | Legal | Doctor / clinic | Reg. number on PDF; signature integrity weak (SEC-02, SEC-18) | Tamper-evident signed PDFs, doctor-only signing, audit; Schedule X drugs should not be e-prescribed. ⚖ |
| R10 | **CERT-In Directions 28 April 2022** (s.70B IT Act): report cyber incidents within **6 hours**; keep ICT system logs for **180 days** within India; synchronise clocks to NTP (NIC/NPL or traceable); designate a point of contact. ⚖ Applicability to a small SaaS: the directions apply to "service providers, intermediaries, data centres, body corporate", so clinicOS as a body corporate is likely covered. ⚖ | Legal | clinicOS | None | Logging pipeline with 180-day retention (Vercel log drain → India-region storage); CERT-In PoC; 6-hour reporting runbook. Cloud providers' NTP is acceptable (document it). |
| R11 | IT Act 2000 s.43A and SPDI Rules 2011 (health = sensitive personal data). Largely superseded once DPDP is fully in force; check the transition timeline under the 2025 Rules. ⚖ | Legal (transitional) | clinicOS and clinic | — | Treat ISO 27001 / IS 17428-style controls as the reasonable-security benchmark until DPDP takes full effect. ⚖ |
| R12 | **ABDM / ABHA:** `abha_id` and `hfr_facility_id` are stored, but there is no ABDM integration. If clinicOS integrates (HIP/HIU), the ABDM Health Data Management Policy, NHA sandbox certification, consent-manager flows and FHIR profiles apply. ⚖ | Contractual (on integration) | clinicOS | Not integrated | Do not collect ABHA numbers unless needed (minimisation); plan certification if ABDM is on the roadmap. |
| R13 | **GST:** invoice serial uniqueness, records kept 6 years (CGST s.36 / r.56). ⚖ | Legal | Clinic | Invoice numbering race (SEC-09) | Fix numbering; retention of billing ≥ 6 years. |
| R14 | **HIPAA:** applies only to US covered entities and their business associates. Customers are Indian clinics treating patients in India, so it is **not applicable** unless clinicOS signs BAAs with US entities. It is useful as a voluntary control reference only. | Not applicable / Voluntary | — | — | Do not claim HIPAA compliance. |
| R15 | **GDPR:** Art. 3(2) applies only if clinicOS offers services to, or monitors, individuals in the EU. Incidental EU tourists treated in India are generally out of scope. ⚖ | Likely not applicable | — | — | Revisit if expanding to the EU. |
| R16 | Messaging: TRAI TCCCPR 2018 (DLT registration of SMS headers/templates), WhatsApp Business policy (opt-in, template approval). ⚖ | Legal / Contractual | Clinic and clinicOS (via MSG91) | Templates synced; opt-out flag exists | Record WhatsApp opt-in evidence per patient; DLT registration per clinic sender. |
| R17 | Voluntary: OWASP ASVS L2, ISO 27001, SOC 2 | Voluntary | clinicOS | None | Target ASVS L2 as v2 acceptance criteria; ISO 27001 later for enterprise sales. |

### 6.2 Immediate legal and operational questions for the owner
1. Is v1 serving real patients? If yes, run forensics for SEC-01/03/04/05 (Supabase API logs, Vercel function logs, `audit_logs` anomalies), and decide with counsel on DPDP/CERT-In notification duties. ⚖
2. Which Supabase region holds the data? Is PITR enabled? (OI-1)
3. Are there signed agreements (ToS/DPA) with clinics, and DPAs with Supabase, Vercel, MSG91 and Google/OpenAI?

---

## 7. OWASP mapping

| OWASP Top 10 (2021) / API Top 10 (2023) | Findings |
|---|---|
| A01 Broken Access Control / API1 BOLA / API5 BFLA | SEC-01, 02, 03, 05, 06, 07, 08, 09, 33 |
| A02 Cryptographic Failures | SEC-22 (plaintext tokens), SEC-18 (no integrity hash) |
| A03 Injection | SEC-20 (PostgREST filter strings), SEC-16 (prompt injection) |
| A04 Insecure Design | SEC-01 (test seams in public API), SEC-04, SEC-30 |
| A05 Security Misconfiguration | SEC-13, SEC-14, SEC-15, SEC-27 |
| A06 Vulnerable Components | SEC-24 |
| A07 Identification & Authentication Failures | SEC-26, SEC-17, SEC-07 |
| A08 Software & Data Integrity | SEC-18, SEC-19 (replay), SEC-02 (actor spoofing) |
| A09 Logging & Monitoring Failures | SEC-29, SEC-15 |
| A10 SSRF / API7 | SEC-10 |
| API4 Unrestricted Resource Consumption | SEC-11, SEC-16 (AI cost) |
| API8 Security Misconfiguration / API9 Inventory | SEC-04 (stray dev/twilio/gupshup handlers), SEC-27 |
| API10 Unsafe Consumption of APIs | SEC-19 (MSG91 inbound trust) |

CSRF: Server Actions get Next.js's built-in Origin check; cookie-authenticated `route.ts` POSTs (`/api/ai/*`) rely on SameSite=Lax cookies plus JSON bodies. Residual risk is low; adding an Origin check in middleware is still recommended (P3).

XSS: no raw-HTML sinks found. Inbound WhatsApp text is rendered as React text in notifications (escaped). React-PDF does not interpret HTML.
