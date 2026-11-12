# Independent review 2: V2-01 `1e42ac9..27e6a92` (01-05, ADR-0005 A1, 01-08 review fixes)

Reviewer: isolated Claude reviewer (fresh context). Read-only. I ran `npm run typecheck` (exit 0) and
`npx eslint . --quiet` (exit 0). I queried the local DB read-only; it is migrated to `000021`. I checked these in the
catalog:
- triggers on `referrals` and `memberships`;
- function ACLs, `prosecdef` and `proconfig` for every function in 000021;
- the `memberships` CHECK constraints (both validated);
- the `referrals` policies and FKs.

No tests were run. The per-run counts below come from the evidence files.

## Verdict: **approve-with-fixes**

No Critical or High findings. Every "Fix in V2-01" item from the triage is implemented in code or SQL, not only in
tests, except IR-M1, which is only partly met (see M1). The migration is idempotent and its SECURITY DEFINER hygiene
is correct. The database role rules match the app permission matrix. I found no regression in these legitimate flows:
- share links (all types);
- staff edit (owner and admin);
- the self-profile save;
- referral acknowledge and close;
- the webhook confirm, cancel and reschedule replies;
- the reschedule page;
- `/api/v1` when it is enabled.

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 4 |
| Info | 4 |

---

## Medium

### M1. IR-M1 is only partly met: no "before" run, and the evidence is not committed
- **Where:** `.planning/phases/01-security-containment/evidence/`. Git status shows it as untracked. It holds
  `commit.txt` (`27e6a92`, clean tree), `full-run-{1,2}.json`, `summary.json` (81 files, 1019/1019 passing in both
  runs, teardown verified) and `static-checks.json`. `scripts/phase-evidence.mjs` runs only against the checked-out HEAD.
- **Scenario:**
  - Roadmap V2-01 acceptance item 10 says "existing suites pass on the local stack **before and after**".
  - IR-M1 asked for the runner output at the baseline (`1491899`) as well as at the final SHA, plus the list of retired
    specs.
  - Only the "after" half exists, and it lives only in an untracked directory. At the gate the PO cannot tie it to a
    commit, and DoD 5 asks for the commit SHA.
- **Fix:**
  - Run `scripts/phase-evidence.mjs` in a worktree at `1491899`, into `evidence/before/`.
  - Commit both evidence sets, or record their sha256 in the VERIFICATION.md next to the SHA.
  - Add the retired-spec list.
  - The script itself is fine. It relies on `tests/setup/worker-guard.ts`, which blocks every non-loopback socket and
    DNS lookup, so it cannot reach hosted Supabase.

---

## Low

### L1. "Sign & Bill" can no longer be retried after a partial failure
- **Where:**
  - `features/consultation/service.ts:628-631` and `:671-673`: a visit that is already signed is now refused, which
    P1-23 requires.
  - `features/billing/service.ts:704-707` (`completeAndBillConsultation`): it calls `completeAndSignConsultation`
    first and returns its error.
- **Scenario:**
  1. The doctor clicks Sign & Bill.
  2. Sign-off commits, then `createVisitInvoice` fails (for example a transient error) and the modal shows the error.
  3. On retry, step 1 returns "This consultation is already signed.", so the modal can never create the invoice.
  4. Before this change, the retry re-signed the visit and carried on to billing.

  A fallback exists: the front-desk checkout drawer (`components/queue/checkout-drawer.tsx:253`) can still invoice
  the visit, so nothing is lost. The doctor's flow is the part that breaks.
- **Fix:** in `completeAndBillConsultation`, treat "already signed by this flow and no invoice yet" as a resumable
  state: skip step 1 when `status='completed'` and the visit has no invoice. Or return a distinct result code that
  the modal maps to "Signed; finish billing at checkout".

### L2. The `/api/v1` switch is enforced only in middleware
- **Where:**
  - `lib/api/enabled.ts` is imported only by `middleware.ts:3,10`. No v1 handler calls it, and neither does
    `lib/api/auth.ts` `authenticateApiKey`, `docs` or `openapi.json`.
  - The `lib/env.ts` boot refusal covers only `NODE_ENV=production` with `API_V1_ENABLED=true`. It does not cover the
    default-off case.
- **Scenario:** any future middleware bypass or matcher gap makes the full service-role v1 surface reachable while
  the flag is off. Recent examples are the `x-middleware-subrequest` class (CVE-2025-29927) and a matcher edit that
  drops `/api/v1/:path*`. The doc comment in `lib/api/enabled.ts` says the check "fails closed at the request edge as
  well", but it is the only check.
- **Fix:** call `apiV1Enabled()` at the top of `authenticateApiKey` (return 404) and in the docs and openapi routes,
  so both layers have to fail.

### L3. Migration 000021 validates the new CHECKs without cleaning the data first
- **Where:** `supabase/migrations/000021_review_fixes.sql:607-615`. It runs `ADD CONSTRAINT … NOT VALID`, then
  `VALIDATE` straight away in the same transaction. No `UPDATE` brings old rows into range first.
- **Scenario:**
  - Before this change, the service accepted slot lengths up to 180 (`updateDoctorSlotDuration`, and the old
    `staffEditSchema` `max(180)`), and `availability_schedule` was `z.any()`.
  - Any environment holding a row with a duration from 121 to 180, or a schedule in a different shape, fails the whole
    migration on `VALIDATE`. That includes the hosted test project, staging, or a v1 data import.
  - Separately: NOT VALID followed by VALIDATE in one transaction gives no lock benefit, because the ACCESS EXCLUSIVE
    lock from ADD is held until commit.
- **Fix:** follow expand → migrate → contract.
  - Add `UPDATE public.memberships SET default_slot_duration_minutes = LEAST(GREATEST(...,5),120) WHERE … NOT BETWEEN 5 AND 120`.
  - Reset invalid schedules to the column default (`WHERE NOT public.is_valid_weekly_schedule(availability_schedule)`).
  - Or move the `VALIDATE` into a later migration.

### L4. IR-L3 (profile update before the role change) has no test, and an admin's credential clear is silently dropped
- **Where:** `features/settings/service.ts:352-442`. The reorder and the owner-only pre-check are implemented
  correctly. No spec covers them: `grep -rn "IR-L3" tests` returns nothing, and `review-fixes-app/db.spec.ts` have no
  case where the profile update fails and the role is then left unchanged.
- **Second issue:** at `:375-388`, when an admin clears a doctor's `qualifications` or reg no (submits empty), the
  service drops the field from the payload and returns `success: true`. The UI says the change was saved; nothing
  changed.
- **Fix:**
  - Add a test: an admin changes the role and sends an invalid phone, then assert the role is unchanged.
  - Add a test for the pre-check: an admin tries to change an admin row's role, then assert no write happened.
  - For an admin, treat a non-empty → empty credential as a change and refuse it, as the non-empty case already is.

---

## Info

- **I1.** The `/api/v1` PATCH and GET routes still return `fetchErr.message` / `updateErr.message`, at
  `app/api/v1/visits/[id]/route.ts:150-151,239`, and so do other v1 routes. This was outside the IR-L2 list, and the
  API is off by default. Pick it up with P1-25.
- **I2.** The webhook "cancel" action still cancels a `waiting` or `in_consultation` visit on a late "cancel" reply
  (`app/api/webhooks/messaging/[provider]/route.ts`, the cancel branch). AR-L1 asked only about confirm, and the sender
  binding now limits who can send it. Consider the same booked/confirmed gate.
- **I3.** `finalizeVisitAmendment` and `AmendmentModal` are not referenced from any page or component (grep). The
  new refusals are correct:
  - `completeAndSignConsultation` refuses reopened visits (signed_at set, in_consultation);
  - the v1 PATCH lock refuses them too;
  - `saveConsultationDraft` still allows drafts on them.

  But the amendment flow has no UI entry point today, so the "reopen → edit → finalize" path is exercised only by
  tests. This is not a regression.
- **I4.** No tests cover AR-L6 `otp_expiry = 600` or the IR-L4 `extensions`-schema case. Locally pg_trgm is in
  `public`, so the IR-L4 test would pass without the fix. Neither can be tested further locally, and the IR-L4 code is
  correct: the schema is resolved from `pg_extension` and `quote_ident`-ed, and `search_path` stays `''`.

---

## Checks that held (verified against code and catalog)

**Migration 000021**
- **Idempotence:** functions use `CREATE OR REPLACE`; triggers use `DROP TRIGGER IF EXISTS` then CREATE; constraints
  use `DROP CONSTRAINT IF EXISTS` then ADD; the `search_medicines` DO block can run again.
- **Every function sets `search_path=''`.** These are SECURITY DEFINER: `share_token_resource`, `create_share_token`,
  `revoke_share_token`, `create_reschedule_token`, `get_reschedule_context`, `consume_reschedule_token`,
  `reschedule_token_visit` and `search_medicines`.
- **Trigger functions and `share_type_roles` are not SECURITY DEFINER,** and they have no `anon`/`authenticated`
  EXECUTE.
- **Catalog ACLs:**
  - `create_share_token`/`revoke_share_token`: authenticated and service_role.
  - Reschedule context and consume: anon, authenticated and service_role.
  - `create_reschedule_token`, `reschedule_token_visit` and `share_token_resource`: service_role only.
- **Trigger bypass for system writes:** both triggers pass `auth.uid() IS NULL`, so the service role and the
  v1 / webhook paths are unaffected. `anon` cannot reach the bypass: it has no row through referrals RLS, and no
  grant on memberships (000019).
- **`change_member_role`** (SECURITY DEFINER; `auth.uid()` keeps the caller) changes only `role`, so the profile
  guard never blocks it.
- **Referral guard:** the target tenant can change only `status` (sent → acknowledged), `acknowledged_at` and
  `updated_at`. The guard compares jsonb diffs over all columns, so `pdf_storage_path`, `tenant_id`, `patient_id` and
  the clinical columns are covered. `acknowledgeReferral` writes exactly those three columns. `closeReferralLoop` is
  originating-tenant only (`.eq("tenant_id")`), so it is unaffected. There are no other BEFORE triggers on
  `referrals`.
- **Share target binding:**
  - The referral path is derived.
  - The prescription path must sit under `<tenant>/<visit>/`, which matches `features/prescriptions/pdf/generator.ts:84`.
  - The lab document path must sit under `tenants/<t>/patients/<p>/`, which matches `features/labs/service.ts:92` and
    the v1 lab-orders check.
  - The invoice path is derived.
  - A NULL path gives a clean 404 (`features/sharing/system.ts:46`).
  - `getReferralSignedUrl` and `getDocumentSignedUrl` apply the same rules in the app.
- **Reschedule:**
  - The horizon is 90 days.
  - The overlap check runs under a per-doctor advisory lock taken after the token and visit row locks, so there is
    no lock-order inversion.
  - A refused attempt leaves the token usable.
  - A new link revokes the visit's older unused links.
  - `reschedule_token_visit` requires `access_count > 0`, so a superseded link never triggers the "rescheduled"
    notification.
  - The lookup is clamped to at most one day within [now−1d, now+91d].
  - The route maps `too_far`→400 and `slot_taken`→409, and the page shows `data.error`.

**DB ↔ app role mapping:** `share_type_roles` (000021:162-176) equals `SHARE_LINK_PERMISSIONS` × `ROLE_PERMISSIONS`
(`lib/permissions/matrix.ts`) for every role and type:
- prescription: owner, doctor, nurse;
- invoice: owner, admin, doctor, nurse;
- patient_document, referral and appointment: all roles.

The AR-L4 trigger rules (credentials: self or owner; owner/admin name and phone: self or owner) match the
`updateStaffMember` pre-checks.

**01-05**
- **v1 PATCH:**
  - zod validation (unknown status → 422);
  - the lock is checked before any write and repeated in the UPDATE filter (`.neq status completed .is signed_at null`);
  - matching 0 rows → 409.
- **Lab orders:** zod plus `isPatientStoragePath`, which refuses traversal, `%`, backslashes and control characters;
  the tenant comes only from the key; the storage path is no longer in the audit row.
- **Sign-off:** the visit is claimed with a conditional UPDATE before the Rx is sealed. The non-existent
  `queue_tokens.updated_at` write is removed. `doctor_id` in the outbox comes from the visit.
- **Middleware:** `/api/v1` and `/api/v1/:path*` are explicit matchers, so `.png`-suffixed ids cannot skip the
  check. Look-alike prefixes are not matched.
- **Env schema:** `API_V1_ENABLED` is `"true"|"false"` with a default of false. A production `true` throws at boot.
  The client bundle sees the default.
- **Next:** 15.5.28 is installed and pinned.
- **ADR A1:** the importer list matches the real importers of `features/sharing/system.ts`.

**App fixes:**
- **AR-L1 (webhook):** the sender must equal the stored recipient (10-digit compare); acks go to the stored number;
  confirm applies only from `booked`, and `confirmed` gets the acknowledgement only. `from` is gone from the audit
  metadata.
- **AR-L5:** the token and phone are removed from the labs and referrals audit rows.
- **IR-L1:** `resolveServiceContext` passes through only the two known membership-error messages; anything else gets
  `CONTEXT_FAILURE_MESSAGE`, and `getActiveMembership` logs only the error code.
- **IR-L2:** every line listed in the review is fixed. A grep of the named files finds no `error.message` or
  `err.message` returned to the client, and no fixed-text `throw`s were masked by `clientErrorMessage`.
- **Shared referral link:** the PGRST201 embed bug is fixed (`tenants!referrals_tenant_id_fkey`; the FK name is
  confirmed in the catalog).

---

## Per-triage-item status

| Item | Status | Fix location | Test that would fail without the fix |
|---|---|---|---|
| AR-M1 referral path substitution (+ Rx/doc binding, target acknowledge-only) | **Fixed** | 000021 §1a/§1b; `features/referrals/service.ts` `getReferralSignedUrl`; `features/labs/service.ts` `getDocumentSignedUrl` | `review-fixes-db.spec.ts:302,344,372`: yes |
| IR-M2/AR-M2 role per type, audit in DB, `revoke_share_token` | **Fixed** | 000021 §2; `features/sharing/tokens.ts` | `review-fixes-db.spec.ts:226,245,266`: yes |
| AR-L1 sender = recipient; confirm only from booked | **Fixed** | webhook route `resolveAppointmentByReply`, confirm branch | `webhook-lockdown.spec.ts:266,304`: yes |
| AR-L2 90-day horizon, double booking, newer link revokes older, bounded lookup | **Fixed** | 000021 §3; reschedule route | `review-fixes-db.spec.ts:416,426,441,451`: yes |
| AR-L3 slot and schedule bounds (zod + DB CHECK + route clamp) | **Fixed** (see L3 on data cleanup) | 000021 §4; `features/settings/schema.ts`; reschedule route | `review-fixes-db.spec.ts:472`, `doctor-availability.spec.ts:213`: yes |
| AR-L4 credentials by self or owner | **Fixed** | 000021 §5; `updateStaffMember` | `review-fixes-db.spec.ts:500,528`: yes |
| AR-L5 no token or phone in lab/referral audit | **Fixed** | labs/referrals services | `review-fixes-app.spec.ts:78`: yes |
| AR-L6 `otp_expiry=600`, `minimum_password_length=10` | **Fixed** (config) | `supabase/config.toml` | password: `review-fixes-db.spec.ts:571`: yes; otp_expiry: no test (I4) |
| AR-Info signed draft overwrite refused | **Fixed** | `saveConsultationDraft` (read check + UPDATE filter; the amendment exception is kept) | `review-fixes-app.spec.ts:124-178`: yes |
| IR-L1 no DB text from context resolution | **Fixed** | `lib/auth/context.ts`, `lib/auth/tenant.ts`, PDF routes | `review-fixes-app.spec.ts:180-219`: yes |
| IR-L2 no `error.message` to clients (listed sites) | **Fixed** | notifications, referrals, settings, staff, receipt route; `lib/errors/client-message.ts` | `review-fixes-app.spec.ts:221-260`: yes |
| IR-L3 profile update before role change | **Fixed in code; untested** | `updateStaffMember` | none (L4) |
| IR-L4 pg_trgm in `extensions` or `public` | **Fixed** | 000021 §6 | the local test passes either way (I4) |
| IR-M1 tool-generated before/after evidence | **Partial** | `scripts/phase-evidence.mjs`; "after" only, untracked | n/a (M1) |
| 01-05: P0-05 lab path, v1 visit lock 409, P1-23 sign-off, `API_V1_ENABLED`, Next 15.5.28 | **Done** (see L1, L2) | as listed above | `v1-doctor-guard.spec.ts:347,369,678,718,740`; `api-v1-switch.spec.ts`; `consultation-service-guards.spec.ts:234,264`: yes |
