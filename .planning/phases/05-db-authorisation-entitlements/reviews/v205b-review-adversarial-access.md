# V2-05b adversarial review: access levels, membership/invitations, platform admin RPCs

- Reviewer: isolated adversarial Claude reviewer (no implementer context; the per-plan records and 05-WAVE-NOTES.md were not read).
- Target: `v2/phase-05b-membership-entitlements` at `5e9d1df`, diff from `d670b62` (migrations 000079 to 000091 and the app changes).
- Method: source review of the diff, then attacks on the local stack (Postgres 127.0.0.1:54322) as `authenticated`, with
  `request.jwt.claims` and `request.headers` (`x-clinicos-tenant`) set the way PostgREST sets them. Every run was one
  transaction ending in `ROLLBACK` with synthetic users and clinics (`ad…` ids, `example.test` addresses). Afterwards:
  0 synthetic users and 0 synthetic clinics remain. No `db reset`, no hosted calls, no email sent, no source edits.
- Stack check: the `body_md5` of all 189 functions in `scripts/drift/schema-snapshot.txt` at `5e9d1df` matches the
  live local database, so the results below apply to the reviewed commit.
- The app was not built or run. The database is the control for every data path tested, and the app-only questions
  (redirects on client navigation) were settled by reading the code. See L-4.

## Summary

| Severity | Count |
|---|---|
| High | 0 |
| Medium | 1 |
| Low | 4 |
| Info | 6 |

No locked, onboarding, expired or purged clinic reached tenant data through any table, storage object, definer RPC,
share or reschedule link, `/api/v1` key or job that I tested. Removal, invitation binding and the platform-admin
actor rule held. The one Medium finding is billing abuse of AI usage, not a data leak.

---

## Medium

### M-1: An owner or admin can multiply the trial AI quota by changing `tenants.timezone`

**Where.** `private.ai_gate` (000091) computes the period as
`'trial:' || to_char(public.tenant_local_date(r_tenant, v_trial_start), 'YYYY-MM-DD')` while the clinic is trialing.
In paid months it uses `tenant_local_date(r_tenant, now())`. `tenant_local_date` reads `tenants.timezone`, which
any `clinic:manage` member (owner or admin) can update directly through PostgREST:

- `authenticated` holds table-level UPDATE on `tenants`;
- the `tenants_update` policy only requires `tenant_ids_with('clinic:manage')`;
- `tenants.timezone` has no CHECK constraint;
- `tenant_local_date` accepts any offset from `-23:59` to `+23:59` and any `pg_timezone_names` entry.

So the period key is controlled by the clinic, and each new key starts a fresh 1,500-draft trial pool (PO-21).

**Reproduction** (local, one transaction, rolled back). The full harness is the seed below plus these statements:

```sql
-- as postgres: clinic F trialing on `standard` (trial plan standard_trial: ai.scribe on, monthly_drafts 1500)
update public.tenant_subscriptions set trial_start = '2026-11-14 20:00:00+00' where tenant_id = :F;
insert into public.ai_usage_monthly (tenant_id, period, feature, units) values (:F, 'trial:2026-11-15', 'ai.scribe', 1500);
-- as the owner of F (request.jwt.claims sub = owner, request.headers x-clinicos-tenant = F, SET LOCAL ROLE authenticated)
select public.set_ai_opt_in(:F, true, 'v1');
select public.ai_preflight('ai.scribe', :visit_in_F);                    -- over_quota
update public.tenants set timezone = '-12' where id = :F;               -- RLS allows it (clinic:manage)
select public.ai_preflight('ai.scribe', :visit_in_F);                    -- ok
select public.ai_commit(public.ai_reserve('ai.scribe', :visit_in_F, 60)); -- 1
```

**Observed.** `over_quota` → `ok`. `ai_usage_monthly` then holds `trial:2026-11-14 = 1` next to
`trial:2026-11-15 = 1500`. For a single instant (`2026-11-14 12:00Z`), the timezones `-23:59`, `-12`/`Asia/Kolkata`
and `+14`/`+23:59` give three different local dates (11-13, 11-14, 11-15). That makes three trial pools, so about
4,500 drafts of real model spend instead of 1,500. Paid clinics can also borrow the next month's pool, or reuse an
unused previous one, by switching the offset near a month boundary.

**Fix.** Do not derive a metering period from a column the clinic can edit. Use the billing anchor (SUB §4,
Asia/Kolkata) for every AI period, for example `'trial:' || to_char((trial_start AT TIME ZONE 'Asia/Kolkata')::date, …)`
and an IST month. Alternatively, store the period key on `tenant_subscriptions` when the trial or period starts.
Separately, consider a CHECK on `tenants.timezone` (an allow-list of IANA names or a bounded offset form) and a column
grant that keeps it out of reach of anyone but the owner. Add a pgTAP leg: change the timezone, then expect
`over_quota` to stay.

---

## Low

### L-1: A removed owner or admin keeps receiving webhook events through subscriptions they created

`remove_member` (000087, re-bound in 000090) revokes the target's API keys and the pending invitations they created,
but it does not touch `webhook_subscriptions.created_by = target`. The `webhook.deliver` handler checks only
`is_active` and the tenant (`lib/jobs/internal/handlers/webhook-deliver.ts`, step 2). An owner or admin who pointed a
subscription at their own endpoint before removal keeps getting `appointment.*`, `visit.completed`,
`prescription.issued` and `lab_result.ready` events after removal. These carry patient, visit and document ids,
schedule times and lab document titles (`private.webhook_event_subject`). Like an API key, this is a standing
credential of the removed person. AUTH_REDESIGN §3.6 lists keys and invites only, so this is a gap in the spec, not
a deviation from it.

Reproduction is by code: `remove_member` has no `webhook_subscriptions` statement, and delivery ignores the creator.

**Fix.** In `remove_member`, set `is_active = false` on the target's subscriptions in that clinic, count them in the
audit row as `webhooks_disabled`, and add a pgTAP leg. Alternatively, have delivery require the creator's active
owner or admin membership.

### L-2: API-key authentication does not re-check the creator's membership

`authenticateApiKey` (`lib/api/auth.ts`) checks the key hash, `revoked_at` and the clinic's access level. It does
not check that `created_by` is still an active owner or admin of the clinic. `remove_member` revokes keys, but:

- a demotion (`change_member_role` admin → receptionist) leaves the admin-scope key working;
- the reserved `suspended` status (V2-11/V2-13c) will not revoke anything.

**Fix.** At authentication, join `memberships` on `(tenant_id, created_by)` and require `status = 'active'` and a
role of owner or admin, or revoke keys in `change_member_role` when a role leaves owner/admin.

### L-3: Inbound WhatsApp replies still change visits of a locked clinic

`app/api/webhooks/messaging/[provider]/route.ts` uses the system client and never checks the access level. A patient
reply on a locked or expired clinic still confirms or cancels the visit, writes `in_app_notifications` and
`audit_logs`, and mints a reschedule token. The acknowledgement and the link are then silently dropped, because
`claim_jobs` cancels the clinic's message jobs and `consume_reschedule_token` answers `clinic_unavailable`. So the
patient's visit changes and they are not told. No clinic data leaks, but this is a write path that ignores SUB-02.

**Fix.** After `resolveAppointmentByReply`, call `tenant_access_for_system(tenant_id)`. If the level is not `full`,
send only the tenant-less "clinic unavailable" reply, or ignore the reply.

### L-4: The locked redirect does not run on client navigation for pages that do not call the access guard

`(dashboard)/layout.tsx` redirects only on a full render. On a client navigation, Next renders only the page segment.
`withPageAuth` then redirects only if the loader throws `TenantLockedError`. These pages read through
`getActiveMembership()` plus RLS instead of `requireServiceContext`/`requirePermission`, so they render an empty shell
for a locked clinic instead of redirecting:

- `patients/page.tsx`
- `page.tsx`
- `visits/page.tsx`
- `consultation/[id]/page.tsx`
- `staff/page.tsx`

`patients/new` and `billing/register` have no page guard at all. RLS returns 0 rows, which I verified with the
table sweep, so nothing leaks. The effect is a confusing state for a tab that was open when the clinic locked.

**Fix.** Call `assertTenantAccess` in `getActiveMembership`'s page path (or in `withPageAuth` itself) so every
dashboard page throws `TenantLockedError` and redirects.

---

## Info

- **I-1: Theoretical gap in `claim_jobs`.** Its cancel step skips rows that another transaction has locked
  (`SKIP LOCKED`). The claim step that follows has no access predicate, so a non-full clinic's job that was locked
  during the first statement and released before the second could be claimed. The window is microseconds.
  Defence in depth: repeat `tenant_access_level(...) = 'full'` (or tenant-less, or an exempt kind) in the `locked`
  CTE.
- **I-2: Suspension can be undone by an admin.** `suspended` is reserved, but an admin (not only the owner) can still
  turn a suspended doctor, nurse or receptionist into an active one with `remove_member` (suspended → removed) and
  then a re-invite (`invitation_consume` reactivates `removed`). Decide this before V2-11/V2-13c gives `suspended` a
  meaning. For example, `remove_member` could keep `suspended`, or reactivation could need the owner.
- **I-3: Active-clinic fallback.** `authz.active_tenant_id()` falls back to the caller's single active membership when
  the header names a clinic where they are not active. A member removed from F who is still active in L, and who sends
  `x-clinicos-tenant: F`, resolves to L. No access is gained (verified), but the answer is for another clinic than
  the one requested. Consider returning NULL when a header is present but not honoured.
- **I-4: Platform SQL channel.** `private.platform_actor` lets any `service_role` session name any active admin as
  `p_actor` (channel `sql`). That matches SUB §8.1, but any server code path with the system client can write
  platform audit rows in an admin's name. Keep platform RPC calls out of the app's system client (an ESLint zone),
  or give `service_role` no EXECUTE on `platform.*` and use `postgres` only.
- **I-5: Completing an unconfirmed account.** `redeemInvitationWithPassword` sets the password and confirms an
  existing unconfirmed account. It does not clear that account's `user_metadata`, or end other sessions as AUTH §3.1
  requires on the signup path. With `enable_signup = false` no attacker can create such an account today. This
  becomes relevant when owner signup returns (V2-13b, pre-account hijacking).
- **I-6: Visit-existence oracle in a locked clinic.** `ai_preflight` answers `locked` for an existing visit and
  `forbidden` for an unknown one. `log_audit('dpdp.patient_erasure')` likewise reveals whether a patient id is
  soft-deleted. Both are visible only to members of that clinic.

---

## Attacks that held

**Access levels (A)**

- A table sweep ran as the owner of a locked (`expired`) clinic over every public table with `tenant_id` and SELECT
  for `authenticated`. Only `memberships` (own row) and `tenant_subscriptions` were visible. `patients`, `visits` and
  `clinical_notes` returned 0 rows even though the data exists. Storage objects returned 0 rows under the locked
  header and the clinic's own object under the full header.
- A member of a full clinic F and a locked clinic L saw nothing of L's data with header L, F's data only with
  header F, and `active_tenant_id()` was NULL with no header.
- A member cannot raise their own access level. `tenant_subscriptions`, `tenant_entitlement_overrides`,
  `platform_settings` and `platform_admins` have no DML grants (permission denied). `billing_internal` has no schema
  usage for `authenticated`. `start_trial` is service_role only. `tenants` exposes no billing column.
- Every definer function executable by `anon` or `authenticated` was enumerated, and each one binds through
  `full_tenant_ids`, `tenant_ids_with` or `has_permission`, or checks `tenant_access_level` itself. The exceptions are
  intentional: `log_audit`, `my_tenant_access`, `my_entitlements`, `ai_commit`/`ai_release`, `consume_invitation` and
  `create_clinic_with_owner`. No function in `platform`, `billing_internal`, `private` or `authz` has PUBLIC EXECUTE.
  There are no views.
- Every RLS policy except catalogue reads uses the full-level helpers.
- Share links: `resolve_share_token` checks the level before reading anything. An `expired` clinic's prescription
  returns metadata only, with no signing or download; `share_token_object` also refuses, and the app checks again
  with `tenant_access_for_system`. Reschedule links check the level before the revoked/expired branches, so a
  locked clinic's phone number is not returned.
- `/api/v1`: every data route goes through `authenticateApiKey`, which answers 402 for a clinic whose level is not
  `full`.
- Jobs: `claim_jobs` cancels the due jobs of non-full clinics (`email.invite` included) before claiming.
- App guards: `requireServiceContext`/`requirePermission` default to `full`. Only `getSubscriptionOverview` uses
  `billing` access. The locked and onboarding pages cannot loop: each destination maps to itself, and a `none` level
  falls through the overview's try/catch.

**Membership and invitations (B)**

- Removal: after `remove_member`, the removed member reads 0 rows in that clinic with a still-valid JWT, and
  `my_tenant_access` returns NULL for it. Self-removal is refused (`SELF_REMOVAL`). The last-owner rule counts active
  owners under a row lock. `memberships` exposes no `status`/`role` column grant, so self-reactivation is impossible.
- Invitations: re-invite reactivates the same row with the invited role, audited with `reactivated: true`. A different
  confirmed account with the right token gets `INVITATION_EMAIL_MISMATCH`. `consume_invitation_for`,
  `invitation_issue_token` and `invitation_accept_context` are permission-denied for `authenticated`. Resend and
  revoke null the hash and bump the version; a stale job mints nothing. `peek_invitation` returns only the status,
  clinic name, role and a masked address for a known hash.
- Accept with password: the server-side Turnstile check fails closed (unset secret, hostname, timeout), and the verify
  URL can be overridden only in test or e2e to a loopback address. Admin API calls act only on the address the
  database returns for the token hash. A confirmed account gets `account_exists`, never a password overwrite.
- Role escalation: owner/admin invitations, resends and revokes are owner-only. `change_member_role` keeps
  owner/admin changes owner-only.

**Platform admin RPCs (C)**

- A non-admin at aal2 and an admin at aal1 both get `PLATFORM_ADMIN_REQUIRED`.
- An admin at aal2 who names another user in `p_actor` is recorded as themself, with channel `ui`.
- `platform_admins` and `platform_audit_log` are permission-denied for `authenticated`.

## Seed used (synthetic, rolled back every run)

Five `auth.users` rows with `ad000000-…` ids and `@example.test` addresses, and three clinics:

- L: `expired`, with `access_ends_at` in the past;
- F: `trialing` on `standard`;
- O: `incomplete`.

Memberships: owner L, receptionist L, two owners of F, a doctor in both L and F, and owner L also owns O. Each of L
and F has one patient and one walk-in visit. The impersonation settings are `request.jwt.claims` =
`{"sub":…,"role":"authenticated","aal":…}`, `request.headers` = `{"x-clinicos-tenant":…}` and
`SET LOCAL ROLE authenticated`.
