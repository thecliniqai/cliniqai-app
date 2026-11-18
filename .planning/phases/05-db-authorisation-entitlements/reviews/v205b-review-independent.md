---
phase: 05-db-authorisation-entitlements (V2-05b)
reviewed: 2026-11-15T01:20:00Z
depth: deep
scope: git diff d670b62...5e9d1df (branch v2/phase-05b-membership-entitlements)
files_reviewed: 34
files_reviewed_list:
  - supabase/migrations/000079_contract_05a.sql
  - supabase/migrations/000080_billing_schemas.sql
  - supabase/migrations/000081_subscription_catalogue.sql
  - supabase/migrations/000082_tenant_subscriptions.sql
  - supabase/migrations/000083_billing_access_functions.sql
  - supabase/migrations/000084_subscription_seeds.sql
  - supabase/migrations/000085_platform_admin_rpcs.sql
  - supabase/migrations/000086_drop_v1_subscription_tables.sql
  - supabase/migrations/000087_membership_status.sql
  - supabase/migrations/000088_invitations_v2.sql
  - supabase/migrations/000089_invitation_accept_context.sql
  - supabase/migrations/000090_access_enforcement.sql
  - supabase/migrations/000091_ai_gating.sql
  - features/auth/invite-flows.ts
  - features/auth/system.ts
  - features/auth/actions.ts
  - features/staff/actions.ts
  - features/staff/service.ts
  - features/staff/invite.ts
  - features/billing/subscription.ts
  - features/sharing/system.ts
  - features/sharing/public-links.ts
  - lib/auth/tenant.ts
  - lib/auth/page.ts
  - lib/auth/access-page.ts
  - lib/auth/access-redirect.ts
  - lib/auth/turnstile.ts
  - lib/api/auth.ts
  - lib/jobs/internal/handlers/email-invite.ts
  - lib/entitlements/require-entitlement.ts
  - lib/storage/types.ts
  - app/(auth)/join/page.tsx
  - app/(auth)/join/join-forms.tsx
  - app/r/[token]/page.tsx
findings:
  high: 0
  medium: 2
  low: 7
  info: 7
  total: 16
status: issues_found
---

# V2-05b independent review

Reviewer: isolated Claude reviewer (fresh context). Per instructions, the per-plan records and `05-WAVE-NOTES.md`
were not read. Requirements consulted: `05-PLAN.md` (05b part, by grep), `SUBSCRIPTIONS_AND_PLANS.md` §7.2 / SUB-D6,
`AUTH_REDESIGN.md` §3.2 / §3.6 / throttles.

"Verified by running" = reproduced against the local stack (127.0.0.1:54322, migrations through 000091), every write
inside `BEGIN … ROLLBACK`; nothing was left behind. "By reading" = traced in source only.

## Summary

The core security design holds up well. I could not break tenant isolation, the access-level stop, the platform actor
rule, the invitation address binding or the AI quota lock. Specifically:

- every policy outside the public catalogues and `tenants_select` goes through `full_tenant_ids`, `tenant_ids_with`,
  `has_permission` or `billing_tenant_ids` (checked in `pg_policies`);
- every SECURITY DEFINER function that `authenticated` can execute is either bound to the full active clinic or
  intentionally level-neutral (checked in `pg_proc`);
- new tables have RLS on and no anon access;
- the membership column grants exclude `status`, `removed_at` and `removed_by`;
- the v1 subscription tables have no remaining reader (app or SQL);
- `ai_reserve` serialises on the usage row.

The defects are at the edges. A cancelled job leaves its delivery row stuck and unredacted. An invitation silently
keeps an earlier, more privileged role when the address is invited again. There are also several spec deviations and
latent traps for V2-12/V2-13b. There are no High findings.

---

## Medium

### M-1: `claim_jobs` cancels jobs of a non-full clinic but leaves their `communication_queue` / `webhook_delivery_queue` rows `pending` forever, with PHI template params unredacted

**Where:** `supabase/migrations/000090_access_enforcement.sql:1244-1265` (the new cancel UPDATE). Interacts with the
existing triggers `jobs_message_dead` / `jobs_webhook_dead` (fire only on `status = 'dead'`) and
`communication_queue_scrub_payload` (redacts `template_params` / `metadata` only on terminal statuses `sent`,
`delivered`, `read`, `dead_letter`, `cancelled`; migration 000024:100).

**What goes wrong:**
1. The job moves to `cancelled`. Neither dead-trigger fires.
2. The delivery row stays `pending` permanently. It holds the patient name, appointment details and recipient phone in
   `template_params` and `recipient_phone`, unredacted.
3. No in-app "delivery failed" alert is raised, so the clinic is not told the reminder never went out.
4. The communication log shows "queued" indefinitely.
5. After renewal the same reminder cannot be re-enqueued, because the dedupe key returns the stale pending row. That is
   intended ("never sent late"), but the row is never closed.
6. `webhook.deliver` rows behave the same way and stay `pending`.
7. `email.invite` jobs are also cancelled. After renewal the owner sees a pending invitation that was never emailed.

**Verified by running** (rolled back):
- Created a synthetic tenant and set its subscription to `expired`.
- Inserted a `communication_queue` row; its trigger enqueued `message.send`.
- Called `claim_jobs(ARRAY['message.send'],…)`.
- Result: job `cancelled|tenant_not_full`; queue row still `pending` with `{"patient_name": "Synthetic Person"}`.

**Test gap:** `tests/subscriptions/lock-enforcement.spec.ts:284-329` enqueues `message.send` with a made-up
`communication_id` and no delivery row, so it passes whether or not the delivery row is handled.

**Fix:** have the cancel step close the dependent row in the same statement (or through an
`AFTER UPDATE OF status … WHEN new.status = 'cancelled'` trigger that mirrors `message_job_dead` / `webhook_job_dead`):
- `communication_queue.status = 'cancelled'` with `error_message = 'tenant_not_full'` (this also triggers the scrub);
- `webhook_delivery_queue.status = 'failed'` with `last_error = 'tenant_not_full'`.

Extend the spec to go through `enqueue_message` and assert the queue row is terminal and redacted.

### M-2: Re-inviting an address with a different role silently keeps the earlier invitation's role (privilege mismatch), and the app reports success

**Where:**
- `supabase/migrations/000088_invitations_v2.sql:191-202`: an unexpired pending invitation is returned with
  `deduped: true` whatever `p_role` is. The concurrent-insert branch at 214-223 does the same.
- `features/staff/actions.ts` `inviteStaff`: ignores `deduped` and returns `{ success: true, inviteId }`.

**Scenario:** an owner invites `x@…` as `admin` by mistake, then "corrects" it by inviting `x@…` as `receptionist`.
1. The UI says the invitation succeeded.
2. No new email is sent.
3. The stored invitation is still `admin`.
4. The invitee accepts and becomes an admin.

The reverse (owner downgrades, a stale higher role survives) is the dangerous direction. The same happens for any role
change within 72 h.

**Verified by running** (rolled back, as the demo clinic's owner through `SET ROLE authenticated` with JWT claims and
the tenant header):
- `invite_staff(…,'admin')` returned `{"deduped": false}`;
- `invite_staff(…,'receptionist')` returned the same id with `{"deduped": true}`;
- the stored role is `admin`; one `email.invite` job exists.

**Fix:**
- In `invite_staff`, when a pending invitation exists with a different role, either revoke it and create a new one
  (same path as the expired branch; the owner-only check already ran for the new role), or raise
  `P0001 INVITATION_ROLE_CONFLICT`.
- In `inviteStaff`, surface `deduped: true` as "An invitation is already pending for this address (role X). Resend or
  revoke it."
- Add a pgTAP leg for "same address, different role".

---

## Low

### L-1: Invite throttles specified in AUTH_REDESIGN are absent

**Where:** `000088` (`invite_staff`, `resend_invitation`), `features/auth/invite-flows.ts`.

AUTH_REDESIGN (line ~407) specifies invite send 20/hour per tenant, resend 3 per invite, and `acceptInviteWithPassword`
10/hour per token hash. None of these exists.
- `resend_invitation` is unbounded: each call mints a job and an email to an arbitrary address through the product's
  SES identity. That is an email-bombing and SES-reputation risk once clinics are self-serve `full` (V2-13b).
- The public accept action is gated only by Turnstile.

The limiter (P1-26) is scheduled for V2-12, so this may be an accepted deferral, but I found no mention in `05-PLAN.md`.

**Fix:** record the deferral explicitly and track it against P1-26. At minimum, cap `resend_invitation` using
`send_count` / `token_version` (for example, refuse when `token_version > 4`), which needs no limiter.

**By reading.**

### L-2: `ai_gate` derives the quota key as `p_feature || '.monthly_drafts'`, so every AI feature except `ai.scribe` is permanently `over_quota`

**Where:** `000091_ai_gating.sql:218`.
- `ai.voice_receptionist` has `ai.voice_receptionist.monthly_minutes`.
- `ai.scribe.voice`, `ai.operations_copilot`, `ai.patient_advice` and `ai.clinical_copilot` have no limit key.
- For all of these, `entitlement_limit` of a non-existent key returns 0, so `v_units + v_live >= 0` and the code is
  `over_quota` even with an override granting the feature.

This fails closed, but V2-12 will hit it as a confusing quota error rather than a clear "unmetered / not configured".

**Fix:** map feature → limit key explicitly (a column on `entitlement_keys`, or a CASE). Decide whether "no limit key"
means unmetered or refused, and add a pgTAP leg for a non-scribe feature.

**By reading** (seed key list in 000084).

### L-3: Staff removal leaves the removed user's webhook subscriptions active

**Where:** `000087` / `000090` `remove_member` (`000090_access_enforcement.sql:599+`).
- Removal revokes the user's API keys (`created_by`) and pending invitations.
- It does not touch `webhook_subscriptions.created_by = target`.

A removed admin who registered an endpoint they control keeps receiving clinic events. Payloads are mostly ids, but
`lab_result.ready` carries the document `title`, and the removed admin knows the signing secret. Revoking keys but not
webhooks is inconsistent under the same threat (T-05-24..26).

**Fix:** in `remove_member`, set `is_active = false` on the target's webhook subscriptions in the tenant, return
`webhooks_disabled`, add it to the audit counts, and add a test.

**By reading** (`\d public.webhook_subscriptions` has `created_by`).

### L-4: SUB-D6 restricted prescription response deviates from the spec

**Where:** `000090_access_enforcement.sql:950-960` together with `share_token_resource`.

SUB §7.2 / SUB-D6 says an expired clinic's prescription link shows "clinic name, doctor name and registration number,
issue date, 'valid prescription'". The restricted answer instead returns:
- `patient_name`, `title`, `original_filename` (contains a resource id prefix), `mime_type`, `report_date`, and the
  clinic name and phone;
- no doctor name or registration number.

The patient's name is PHI and outside the specified metadata set. The doctor details the pharmacy needs for
verification are missing.

**Fix:** build an explicit restricted object (clinic name, doctor name + reg no from `memberships`, issue date,
`valid: true`) rather than stripping keys from the full resource. Add an assertion that `patient_name` is absent.

**By reading.**

### L-5: An owner of a locked clinic cannot remove staff (or change roles) until after renewal

**Where:** `000090` binds `remove_member`, `change_member_role` and `invitation_manager_role` to
`full_tenant_ids()`.

Staff of a locked clinic cannot read data, which is correct. But an owner who lets the subscription lapse and dismisses
an employee cannot remove them before paying. On renewal the dismissed member's still-`active` membership regains full
access, with sessions intact, until the owner removes them, a race the owner can lose. SUB §7.2 lets the billing helper
admit owners for "billing, subscription, export and profile" only, so this may be by design.

**Fix:** let `remove_member` (removal only, not invites or role changes) bind to `billing_tenant_ids()`, or document the
residual risk in the runbook.

**By reading.**

### L-6: `ai_commit` / `ai_release` are not bound to the reserving user

**Where:** `000091_ai_gating.sql:296-366`.

Any member with `consultations:edit` in the clinic can release or commit any reservation of the clinic.
- If a colleague releases a reservation, the original call's later `ai_commit` raises `AI_RESERVATION_NOT_FOUND`
  after the provider call already happened, so the call goes unmetered.
- A member can also call `ai_reserve` directly through PostgREST in a loop. Each reservation blocks quota for up to
  330 s, which is an in-clinic denial of service.

**Fix:** store `created_by` on `ai_quota_reservations` and require `created_by = auth.uid()` in commit and release. Rate
limiting reserve is P1-26 / V2-12.

**By reading.**

### L-7: The referral target guard still accepts a removed or suspended doctor

**Where:** `private.referrals_directory_consent_guard` (pre-existing function, not updated by 05-05). It checks
`memberships` for `target_doctor_id` with `consultations:edit` but no `status = 'active'`.

A referral can be addressed to a doctor who was removed from the target clinic. The app's own pickers filter by status
(`memberOfTenant`, `getTenantDoctorDirectory`); this database guard does not.

**Fix:** add `AND m.status = 'active'` (05-05 intended every membership read in a guard to be status-aware).
`private.audit_logs_actor_guard` has the same pattern for `actor_role` (cosmetic there).

**By reading** (`pg_proc` scan for `memberships` without `status`).

---

## Info

- **I-1: Interim lock-in (planned, confirm with PO).**
  - From 000090, every clinic created by `create_clinic_with_owner` is `incomplete`, so `onboarding`, and has no app
    path to `trialing` until V2-13b.
  - On any existing database, every clinic not comped by the seed is backfilled `incomplete` and locks to
    `/onboarding/billing` the moment 000090 applies (000082:149, 05-P3).
  - This matches R-24/R-25 but should stay visible in the deploy runbook.
- **I-2: `000079` asserts nothing before dropping columns.** It logs D53c (visits still holding moved content) but
  drops the six `visits` columns without checking that D53c = 0 or that `visits_clinical_content_moved` was VALID. It
  is safe by construction (000053 adds the CHECK VALID), but a `RAISE EXCEPTION` when `v_moved > 0` would make the
  data-loss guard explicit.
- **I-3: `remove_member` LAST_OWNER logic counts active owners even when the target is `suspended`.** A suspended owner
  cannot be removed while exactly one active owner exists. `suspended` is reserved and unused today.
- **I-4: `subscription_events` exposes platform-admin `actor_id` values and free-text `reason` to clinic owners and
  admins** (`billing_tenant_ids` SELECT). Consider omitting `actor_id` for `actor_type = 'platform_admin'` in a view.
- **I-5: Entitlement limit semantics.** `lib/entitlements/require-entitlement.ts` documents "null = unlimited / not
  metered", but `resolve_entitlement` never returns NULL: `coalesce(limit, 0)`, so `messaging.monthly_quota` (NULL in
  the seed) reads as 0. Align the comment, or return NULL for "unset", before a V2-12 consumer relies on it.
- **I-6: The server-side Turnstile check does not verify the widget `action`** (`invite-accept`; `lib/auth/turnstile.ts`
  checks `success` and `hostname` only). Low value, since tokens are single-use and same-cost, but cheap to add.
- **I-7: `locked-redirects.spec.ts` (page-loader block) accepts "renders empty" for loaders that call
  `getActiveMembership` directly** (`/`, `/patients`, `/visits`). On a client navigation those pages show an empty
  shell instead of redirecting. The database stop holds, and the layout redirect covers full loads, so this is UX only.

---

## Checked and found sound (no finding)

- **Platform actor rule (000085).** It reads the session `role` GUC, not `current_user`. The SQL branch requires an
  active-admin `p_actor`. Every other caller needs `is_platform_admin()` (aal2 + active row). The `platform` schema is
  not exposed through PostgREST. `set_config('role', …)` cannot be forged by an API role.
- **Invitation binding.**
  - Raw tokens are minted at send time; only SHA-256 is stored; the stale-version job sends nothing.
  - Both redemption paths enforce `lower(btrim(email)) = invited_address`.
  - The unconfirmed-account branch overwrites the password, which closes the pre-account hijack, because with
    `enable_confirmations = true` and phone auth off an unconfirmed account has no session or factors.
  - `invitation_accept_context` refuses ambiguity.
- **Removal.**
  - Removed or suspended rows are excluded by every authz helper.
  - The owner-row lock serialises concurrent last-owner checks.
  - Reactivation reuses the same row.
  - Session deletion is fail-soft.
- **Access stop.**
  - All tenant policies and storage policies use the full helpers.
  - The token RPCs (`resolve_share_token`, reschedule, `share_token_object`) check the level before reading.
  - `/api/v1` returns 402 before counting.
  - Signed-URL TTL is clamped in both `getSignedUrl` and the provider.
- **AI quota.** Usage row upsert, then `FOR UPDATE`, then a fresh-snapshot count of live reservations. That is correct
  under READ COMMITTED, and the concurrency spec exercises it for real.
- **Migration safety.**
  - New columns are NOT NULL DEFAULT or nullable.
  - The pending-invitation dedupe runs before the unique index.
  - `CREATE OR REPLACE` keeps ACLs.
  - No remaining reader of `subscriptions`, `payment_records` or the dropped `visits` columns (app and `pg_proc`).
- **Error text.**
  - Every new refusal maps to a fixed catalogue string.
  - Logs carry `errorTag` / `logWord` only.
  - No token, hash, address or password is logged.

_Reviewer: Claude (isolated independent reviewer, gsd-code-reviewer)_
