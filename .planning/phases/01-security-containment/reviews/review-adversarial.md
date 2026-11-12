# Adversarial security review: V2-01 security containment (`b9d2ad5..1e42ac9`)

Reviewer: isolated adversarial reviewer (fresh context). Read-only. Database checked as migrated on the local stack
(`supabase_migrations` at 000020; `pg_proc`, `pg_policies`, `information_schema` grants). No tests or scripts run.

## Verdict: **PASS WITH FIXES**

No Critical or High findings. I found no way for a tenant-A user to read tenant-B data through the code or functions
this phase changed, and no way for a receptionist, nurse, doctor or admin to raise their own role. Two Medium findings
should be fixed before the gate, or recorded as PO-accepted follow-ups. The Low items can be tracked.

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 7 |
| Info | 5 |

## What held up (attacked, not exploitable)

- **Server actions.** I scanned every `"use server"` module (24 files). Every export authenticates first, through
  `resolveServiceContext`, `requireServiceContext`, `requirePermission` or `auth.getUser()`. The only non-function export is
  the alias `inviteStaffMemberAction = inviteStaff`, which is also guarded. No export takes a tenant, actor or client. Every
  `*_by` column written by a service comes from `ctx.userId`/`session.userId`. No service spreads caller objects into
  insert or update payloads, apart from billing `additional_items`, which is schema-validated.
- **Active tenant.** `getActiveMembership` re-checks the `clinic_active_tenant` cookie against the user's own memberships.
  Role is per tenant.
- **PostgREST `.or()` strings.** Every interpolated value is now `isUuid` or `isDateOnly` guarded: receipt route,
  schedule blocks, slot check, queue, visits and Rx templates (`SPECIALTY_SLUG`). The patient search strips `,()`. The
  notification filters use session values only.
- **memberships.** The database matches the SQL. `authenticated` has only SELECT at table level, plus column UPDATE on the
  7 profile columns (`information_schema.column_privileges`). No INSERT, DELETE or TRUNCATE. A receptionist's PATCH of
  `role`, `tenant_id` or `user_id` is denied by privilege. `change_member_role` behaves as follows:
  - It takes the tenant from the target row.
  - A non-member gets `not_found`, which leaks no tenant.
  - An admin cannot touch owner or admin rows, or grant either role.
  - The last-owner guard runs under a row lock. A concurrent mutual demotion deadlocks, and one side aborts.
  - The change is audited in the same transaction.
- **invitations.** The INSERT policy binds `created_by = auth.uid()`, rejects pre-consumed rows and makes owner/admin
  invites owner-only. UPDATE and DELETE are revoked.
- **SECURITY DEFINER inventory (as migrated).** Every function has a pinned `search_path` (`''`, or `public, pg_temp`
  for the two legacy ones). The only functions `anon` can EXECUTE are `resolve_share_token`, `get_reschedule_context`,
  `consume_reschedule_token`, `normalize_indian_phone_e164` and the pg_trgm helpers. The internal helpers
  (`share_resource_tenant`, `share_token_resource`, `share_token_object`, `reschedule_token_visit`,
  `create_reschedule_token`) are not executable by `anon` or `authenticated`. Queue-token, invoice-number and
  `search_medicines` now reject callers who are not members (`search_medicines` also requires `p_doctor_id = auth.uid()`).
- **Share tokens.**
  - Members cannot insert or update tokens.
  - `create_share_token` takes the tenant from the resource row. A resource in another tenant gives `not_found`.
  - Resolution is bound to tenant and type:
    - an `appointment` token never resolves on `/r` or `/reports/view`;
    - a `prescription` token never resolves on `/reports/view`;
    - a document whose `patient_id` points at another tenant's patient shows "Patient" (the join is tenant-equal).
  - Public responses carry no ids or storage paths.
  - `signSharedObject` requires the token tenant's prefix, plus `validateStoragePath`, before signing with the service
    role.
  - Tokens are 256-bit, so enumeration is not feasible.
  - Reschedule consumption is single-use under `FOR UPDATE`.
- **Webhook.**
  - Only `msg91` is accepted. Other providers and methods get an empty 404.
  - The secret is read from the header only. The comparison is SHA-256 plus `timingSafeEqual`, so length does not leak.
    An unset secret fails closed.
  - The admin client is created only after the secret check.
  - Replies are routed only by `replyMsgId`, using `.eq`, and the visit is read inside the queue row's tenant.
  - The phone fallback is gone.
- **Auth.**
  - Sign-in maps `email_not_confirmed` to `invalid_credentials`.
  - The reset request reports success for unknown accounts and on `over_email_send_rate_limit`.
  - `verifyOtp` is pinned to `recovery`.
  - After `updateUser`, the flow calls `signOut({scope:'others'})`.
  - No Supabase error text is shown.
  - No `next` or redirect parameter exists anywhere in `/login`, `/join` or `/forgot-password`.
  - `enable_signup = false`.
  - The invite token is never returned.

---

## Medium

### M1. A referral's target clinic can redirect the originating clinic's share link to a different patient's letter (cross-tenant write to PHI delivery)
- **Where:** `supabase/migrations/000020_share_token_binding.sql` `share_token_resource`, `referral` branch. It returns
  `_storage_path = COALESCE(NULLIF(f.pdf_storage_path,''), …)`, which `features/sharing/system.ts` `signSharedObject`
  signs with the service role. `features/referrals/service.ts:483-500` (`getReferralSignedUrl`) also trusts the stored
  path.
- **Root cause (known, RLS-06, `000013:230-242`):** the policy `referrals_target_tenant_update` lets the *target*
  tenant UPDATE any column of a referral it received. Verified as migrated: `authenticated` has table-level UPDATE on
  `referrals`, and the policy's WITH CHECK covers only `target_tenant_id`. What is new in this phase is a public,
  service-role consumer of that attacker-writable column. The tenant-prefix check in `isTenantStoragePath` does not
  help, because the substituted path is inside the originating tenant's own prefix.
- **Steps:**
  1. Clinic A sends clinic B referrals R1 (patient P1) and R2 (patient P2). B can SELECT both rows, including
     `pdf_storage_path = tenants/<A>/referrals/<R2>/referral_letter.pdf`.
  2. A user of B runs `PATCH /rest/v1/referrals?id=eq.<R1>` with
     `{"pdf_storage_path":"tenants/<A>/referrals/<R2>/referral_letter.pdf"}`. RLS allows it.
  3. Clinic A runs "Share referral via WhatsApp" for R1. P1 receives a link whose download is P2's referral letter
     (diagnosis, history snapshot). A's own in-app view of R1 shows P2's letter too.
- **Gain:** a different tenant causes PHI to be disclosed to the wrong patient. The same write also lets B rewrite
  `clinical_summary`, `patient_id` and `tenant_id` on A's record (already known).
- **Fix (pick one, or both):**
  - In `share_token_resource`, ignore the stored path for referrals and derive it:
    `'tenants/'||f.tenant_id||'/referrals/'||f.id||'/referral_letter.pdf'`.
  - Or require `f.pdf_storage_path LIKE 'tenants/'||f.tenant_id||'/referrals/'||f.id||'/%'`, and apply the same rule in
    `getReferralSignedUrl`.

  Apply the same per-resource path binding to `prescription` (`<tenant>/<visit_id>/…`) and `patient_document`
  (`tenants/<tenant>/patients/<patient_id>/…`). Pull the narrowing of RLS-06 forward (an `acknowledge_referral` /
  `close_referral` RPC, and drop the broad target UPDATE policy). At minimum, revoke column UPDATE on `pdf_storage_path`,
  `tenant_id`, `patient_id` and the clinical columns.

### M2. Any member can mint anonymous 7-day PHI links by direct RPC, with no audit and no way to revoke
- **Where:** `000020` `create_share_token`. It checks only that the caller is a member (any role). EXECUTE is granted
  to `authenticated`. The table grants were revoked (`REVOKE INSERT, UPDATE, DELETE … FROM anon, authenticated`), and no
  revoke function exists. Repo-wide grep: nothing in `features/` or `app/` sets `revoked_at` on share tokens.
- **Steps:**
  1. A nurse or receptionist signed in to the app takes the session JWT from the browser and calls
     `POST /rest/v1/rpc/create_share_token {"p_resource_type":"prescription","p_resource_id":"<any rx in tenant>"}`.
     The RPC returns `{token, expires_at}`.
  2. `GET /api/r/<token>?download=true` returns a 302 to a signed URL for the PDF, usable by anyone for 7 days.
  3. No `audit_logs` row is written, because auditing happens only in the app services.
- **Gain:**
  - Untraceable, shareable exfiltration links that bypass the role gates ruled in F9 (receptionist has no
    `consultations:view`).
  - Separately: a link sent to a wrong number cannot be revoked by the clinic for 7 days. Before 000020, an owner could at
    least `UPDATE revoked_at` through the API.

  (Same-tenant staff can already read these rows and storage objects through RLS, so the new elements are the
  anonymous bearer link, the missing audit and the lost revocation.)
- **Known overlap:** F17 (raw tokens, `has_permission` deferred to V2-05). The missing revocation and the missing audit
  are not recorded there.
- **Fix:**
  - Inside `create_share_token`, require a role per resource type: prescription and referral need doctor or owner; at
    least exclude roles without the matching app permission.
  - Insert the `audit_logs` row inside the function (`actor_id = auth.uid()`; no token or phone in the row).
  - Add `revoke_share_token(p_token_id)` (owner/admin or creator, tenant from the row, audited).
  - Consider a shorter TTL for clinical documents.

---

## Low

### L1. Webhook actions are not bound to the sender's number
`app/api/webhooks/messaging/[provider]/route.ts` (`handleInboundAction`). Once `replyMsgId` resolves a queue row, the
confirm, cancel and reschedule actions run, and the acks (including the reschedule link) go to `event.from`. The code
never compares `from` with `queueItem.recipient_phone`. "confirm" also sets `status: 'confirmed'` on any visit that is not
cancelled or completed, so a late "yes"/"1" reply moves a `waiting` or `in_consultation` patient back to `confirmed`,
which drops them from the queue.

Exploiting the sender binding needs the MSG91 secret or a provider-side quirk, so this is defense in depth.

**Fix:** require `normalize(from) == normalize(queueItem.recipient_phone)`, and send links only to the stored number.
Only allow confirm from `booked`.

### L2. Self-service reschedule accepts any future time; tokens are single-use per token, not per visit
- `000020` `consume_reschedule_token` checks only `p_new_at > now()`. It does not check the doctor's shifts, schedule
  blocks or double-booking, and has no horizon: a patient, or whoever holds the link, can move the visit to 03:00 or to
  year 2099. v1 had the same gap (`rescheduleAppointment` did no checks); F16 records only the UTC issue.
- Each "reschedule" reply mints a new 24-hour token (`create_reschedule_token`). Older unconsumed tokens stay valid, so
  the visit can be moved repeatedly.
- `get_reschedule_context` takes an unbounded `p_from`/`p_to` from anon callers, so a token holder can list the doctor's
  booked timestamps for all time.

**Fix:**
- Validate the slot in SQL (shift, blocks, no overlap; horizon ≤ N days).
- Revoke the visit's other appointment tokens when one is consumed or minted.
- Clamp the range to ≤ 1 day.

### L3. Member-writable scheduling JSON drives an unbounded loop in a public route (insider DoS)
`000019` grants `UPDATE (availability_schedule, default_slot_duration_minutes)` to `authenticated`. The self-row policy
lets any member edit their own values, and the table has no CHECK constraint (verified in `pg_constraint`).
`app/api/reschedule/[token]/route.ts` GET runs `for (m = start; m + slotDuration <= end; m += slotDuration)` with
`slotDuration = doctor.default_slot_duration_minutes || 15`.

Steps:
1. A doctor sets their own `default_slot_duration_minutes = -5`, for example through PostgREST PATCH.
2. Any reschedule link for that doctor's visit loops forever on the server and grows `generatedSlots` until out of
   memory. A huge `shift.end` such as `"99999:00"` with duration 1 has a similar effect.

**Fix:**
- Add CHECK constraints: duration between 5 and 240, and `availability_schedule` validated (or set only through an RPC
  using `doctorWeeklyScheduleSchema`).
- Clamp both values in the route.

### L4. An admin can rewrite the owner's and doctors' prescriber identity
`features/settings/service.ts` `updateStaffMember` (`clinic:manage`), together with the `memberships_update_tenant`
policy, lets an admin update `full_name`, `qualifications` and `medical_council_reg_no` on *any* member row, including
the owner's. These fields are printed on Rx and receipt PDFs. This is inconsistent with P0-02, where owner and admin rows
are owner-only for role changes.

**Fix:** in the service, and ideally in the policy, admins may edit profile columns of non-owner/non-admin rows only;
credentials (`medical_council_reg_no`, `qualifications`) only by self or owner.

### L5. Raw share token and patient phone written to audit metadata
- `features/labs/service.ts:464`: `metadata: { share_token: token, recipient_phone: doc.patient.phone }`.
- `features/referrals/service.ts:617`: same pattern.

Billing (`:1100`) and prescriptions (`:773`) were cleaned in this phase ("no token or phone in the audit trail"); these
two were missed. Audit rows are readable by owner and admin, and the token is a live bearer credential for PHI.

**Fix:** drop both keys, consistent with the other two services.

### L6. Recovery code brute force and server-side password minimum (config)
`supabase/config.toml` leaves `otp_expiry` at the default (3600 s) and `minimum_password_length` at the default (6).
- The recovery code is 6 digits. `/verify` is not covered by CAPTCHA and is limited only per IP (30 per 5 min), so a
  distributed attacker has about 10^6 guesses' worth of space for an hour per requested code.
- The 10-character policy exists only in the client schema. `updateUser` called directly accepts 6 characters.

**Fix (AUTH-02 config as code):**
- `[auth.email] otp_expiry = 600–900`.
- `[auth] minimum_password_length = 10`.
- Consider `otp_length = 8` for recovery.

### L7. Request-path storage signing on R2 has no tenant check
`lib/storage/index.ts` `getStorageProviderForDb` returns the R2 provider when `STORAGE_PROVIDER=r2` or the `R2_*`
variables are set. That provider uses bucket-wide credentials, which defeats the comment's "storage RLS applies to the
acting user". The request-path signers do not check the path against `ctx.tenantId`:
- `getDocumentSignedUrl` (`features/labs/service.ts:242`)
- `getReferralSignedUrl`
- the Rx and receipt generators

A member can set `patient_documents.storage_path` or `prescriptions.pdf_storage_path` (tenant RLS allows UPDATE) to
another tenant's key and get it signed. This is conditional: R2 is meant to be unset (CLAUDE.md, C23/P1-43 removes R2).

**Fix:** until P1-43 lands, put an `isTenantStoragePath(ctx.tenantId, path)` guard inside `getSignedUrl`/`uploadFile`
for every provider, or make `getStorageProviderForDb` refuse R2.

---

## Info

- **I1.** `create_clinic_with_owner` is still EXECUTE-able by every authenticated user (`000019` revokes only `anon`).
  With signups closed (R1 "default deny"), any staff member can still create a tenant and become its owner. They then
  hold two memberships, and with no tenant switcher (`clinic_active_tenant` is never set by the app) they lock themselves
  out with `MultipleClinicsSelectionRequiredError`. Consider revoking EXECUTE until V2-13b.
- **I2.** `renderSharedReceiptPdf` → `compileAndGenerateReceiptPdf` → `renderAndArchiveReceipt` renders the PDF and
  uploads it with the service role on every anonymous `?download=true` until the object exists. These are
  anonymous-triggered writes and CPU, so it is a rate-limit candidate.
- **I3.** Known, not worse, but note the in-app path: `saveConsultationDraft` (`features/consultation/service.ts:72-150`)
  has no status or `signed_at` check. A doctor can overwrite `clinical_notes` and the other fields of a signed,
  completed visit, and can replace `visits.metadata` wholesale with caller JSON. P1-03 (V2-09a) owns clinical
  immutability, but the interim guard in V2-01 covers only `/api/v1` PATCH; the app action is the more reachable path.
  Consider adding `.is('signed_at', null).neq('status','completed')` to the update filter now (one line).
- **I4.** Pre-existing RLS breadth seen while probing (outside this phase; listed so the gate does not mistake them for
  regressions):
  - `communication_queue`, `in_app_notifications` and `tenant_messaging_config` are `FOR ALL` for any member. A nurse can
    enqueue WhatsApp sends to arbitrary numbers through the clinic's MSG91 account, insert notifications with arbitrary
    `link_url`, or reset `monthly_quota`/`messages_sent_this_month`.
  - `audit_logs` INSERT is open to any member (ARC-17).
  - Default Supabase grants include TRUNCATE to `anon`/`authenticated` on most tables (not reachable through PostgREST).
- **I5.** About 130 `console.error/warn(…, err)` sites log raw PostgREST error objects. Their `details` can contain
  "Failing row contains (…)" with PHI. The cron routes compare `CRON_SECRET` with `!==`, which is not constant-time.
  Both are pre-existing (P1-25 logging).

## Known deferred items: checked, implementation not worse than recorded
- F12 / `API_V1_ENABLED`: no switch exists yet (`grep` finds it only in `.planning`); 01-05 owns it. `/api/v1/**`
  is still live with the service role and API keys hard-coded to `role: "admin"` (`lib/api/auth.ts`). Ensure 01-05 lands
  before the gate.
- F13 (cross-tenant FK references): also visible in service-role joins in the webhook and appointments system
  (`patient:patients(*)` without tenant equality). Not exploitable without another tenant's patient UUIDs.
- F17 (raw tokens readable by all members): as recorded. M2 adds revocation and audit.
- R1 (`/otp` magiclink residual), R9/D10 (invite not bound to email): as recorded.
