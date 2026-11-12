# V2-01 adversarial review 2: plans 01-05 and 01-08 (`1e42ac9..27e6a92`)

Reviewer: isolated adversarial agent, read-only. Evidence comes from reading the source, from Next 15.5.28 internals in `node_modules`, from Node's `URL` parser and from read-only queries on the local DB (migrations applied through `000021`). No tests or servers were run.

## Verdict: FAIL

There are two High findings, and both have small fixes:

- **H1:** the AR-M1 fix ("a stored path that points anywhere else is never signed") can be bypassed with percent-encoded dot segments. The result is a cross-tenant and cross-bucket PHI read through the service-role share-link signer.
- **H2:** the `API_V1_ENABLED` kill switch can be bypassed with a percent-encoded path. The deferrals R10, F10 and F12 depend on that switch.

After H1 and H2 are fixed and re-verified, the remaining items are Low or Info, and the result would be pass-with-fixes.

---

## High

### H1. Encoded `..` in a stored key gets past `share_token_resource` and `signSharedObject`, so the service role signs another tenant's object (new: incomplete AR-M1 fix)

**Where**
- `supabase/migrations/000021_review_fixes.sql:53-57` (patient_document) and `:71-76` (prescription). The only checks are `starts_with(<own prefix>)` and `strpos(path, '..') = 0`.
- `features/sharing/system.ts:52-59`. `isTenantStoragePath` calls `validateStoragePath` (`lib/storage/index.ts:23-38`), which rejects only a literal `..`, a leading `/` and `\`. It does not reject `%`.
- `lib/storage/supabase-provider.ts:68-72` leads to `@supabase/storage-js` `createSignedUrl` (`dist/index.cjs:1060-1062`). The key goes into the URL string unencoded: `${url}/object/sign/${bucket}/${path}`.
- Node's fetch parses that string with the WHATWG URL parser, which treats `%2e%2e` (and `.%2e`, `%2e.`) as `..` and collapses it.

**Verified**
- The local DB returns `t` (check passes) for `starts_with(p, 'tenants/<A>/patients/<P>/') AND strpos(p,'..')=0`, with `p = tenants/<A>/patients/<P>/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/prescriptions/<B>/<visitB>/rx_v1.pdf`.
- Node `new URL('http://…/storage/v1/object/sign/clinic-records/' + p).pathname` gives `/storage/v1/object/sign/prescriptions/<B>/<visitB>/rx_v1.pdf`. That is a different tenant and a different bucket.
- Any member can write the field:
  - `patient_documents_tenant_isolation` is `FOR ALL` for members.
  - `authenticated` has column UPDATE on `patient_documents.storage_path` and INSERT on the table.
  - `prescriptions_update_member` plus column UPDATE on `pdf_storage_path` and `visit_id` allow the same for the prescription variant.

**Attack**
1. A member of tenant A, in any role, PATCHes `/rest/v1/patient_documents?id=eq.<own doc>` directly with their JWT. They set `storage_path` to the string above, or to `…/%2e%2e×4/tenants/<B>/patients/<Q>/labs/<file>` to stay in the same bucket.
2. They call `create_share_token('patient_document', <doc>)`. Every role may do this.
3. They open `/r/<token>`. `share_token_object` returns the path, and `signSharedObject` accepts it because the bucket is in `BUCKETS`, the prefix is correct and there is no literal `..`. The admin storage client then signs B's object, and the visitor is redirected to a valid signed URL for it.

**What the attacker needs:** the victim's object key.
- Prescription keys are fully deterministic: `<tenant>/<visit>/rx_v<N>.pdf` (`features/prescriptions/pdf/generator.ts:84`).
- Tenant A sees the `tenant_id`, `visit_id` and `patient_id` of every inbound referral from B (`referrals_target_tenant_select` returns all columns).
- Former staff of B keep the visit ids and patient ids they saw in URLs. Any authenticated user can still create their own clinic (I1, deferred).
- Lab keys are `tenants/<B>/patients/<Q>/labs/<Name>_<orig>_<date>.<ext>`, which can be guessed when name and date are known.

**Gain:** cross-tenant read of prescription PDFs, lab reports and receipts. The resulting link can be shared anonymously.

**Fix**
- **In the DB:** in `share_token_resource`, require an allowlist, e.g. `path ~ '^[A-Za-z0-9_./-]+$'`, plus no `..` and no `//`. At minimum, refuse `%` and `\`.
- **For prescriptions:** derive the path instead of trusting the column. Check `^<tenant>/<visit>/rx_v[0-9]+\.pdf$` with a regex, or store the version.
- **In the app:** have `signSharedObject` use `isWellFormedStorageKey` / `isTenantScopedStoragePath` from `lib/storage/tenant-path.ts`, which already refuse `%`. Add the same check to `validateStoragePath`.
- **Constraint:** pull the deferred `patient_documents.storage_path` CHECK (F18) forward with the same allowlist. Add a similar CHECK on `prescriptions.pdf_storage_path`.
- **Test:** add a test that fails if a path containing `%2e%2e` reaches `getSignedUrl`.

### H2. A percent-encoded path gets past the `/api/v1` kill switch (new code)

**Where**
- `middleware.ts:6-14` checks `isApiV1Path(request.nextUrl.pathname)` (`lib/api/enabled.ts:11-13`). Nothing else enforces the switch: no v1 handler and not `authenticateApiKey` calls `apiV1Enabled()` (confirmed by grep).

**How Next 15.5.28 routes it**
1. The middleware matcher is tried against both the raw and the decoded pathname (`resolve-routes.js:309-316`, `next-server.js:436-442`), so the middleware does run.
2. The middleware is then handed `params.parsed.pathname`, which is the raw path (`next-server.js:1186-1189`).
3. `NextURL` does not decode it. Checked: `new NextURL('http://x/api/v%31/patients').pathname === '/api/v%31/patients'`. So `isApiV1Path` is false, and the request falls through to the session-refresh branch, which returns `NextResponse.next()`.
4. Routing then calls `fsChecker.getItem`. When not in dev mode, it retries `appFiles` with `decodeURIComponent(itemPath)` (`filesystem.js:365-367, 449-451`), so `/api/v1/patients` matches and its handler runs.

**Attack:** `GET /api/v%31/patients`, `POST /api/v%31/lab-orders`, `/api/v%31/visits`, `/api%2Fv1/appointments`, and similar, with any API key. `/api/v%31/openapi.json` and `/api/v%31/docs` need no auth at all, which makes them a simple probe.
- This works in production, where the switch is supposed to be hard-off (`NODE_ENV=production` forces `apiV1Enabled()` false). In other words, it reaches exactly the environment the switch protects.
- Owners and admins can still mint keys in-app (`features/api-keys/service.ts:95`, `clinic:manage`). Keys from the v1 era also stay usable.
- Every v1 handler runs on the service-role client (inline queries, F12), and API completion has no doctor rule (R10).

**Limits**
- Dynamic `[id]` routes probably cannot be reached this way: `route.match` runs on the raw pathname (`resolve-routes.js:175-185`). Not proven either way.
- HEAD and OPTIONS, letter case (`/API/v1` gives 404) and the trailing slash are handled correctly.
- Repeated slashes and backslashes get a 308 redirect to the normal path, which the middleware then sees.

**Confirm at runtime:** after `next build && next start`, run `curl -i localhost:3000/api/v%31/openapi.json`. Expect 200 today and 404 after the fix.

**Fix (do both)**
- **Edge:** in `middleware.ts`, decode the pathname before the check, e.g. `let p; try { p = decodeURIComponent(pathname) } catch { return 404 }`, and test both the raw and decoded forms. Simpler: 404 any `/api` path that contains `%`.
- **Defence in depth:** call `apiV1Enabled()` inside `authenticateApiKey` (`lib/api/auth.ts`) and in the `docs` and `openapi.json` handlers, so the switch does not depend only on the middleware.
- **Test:** add `/api/v%31/...` and `/api%2Fv1/...` cases to `tests/api/api-v1-switch.spec.ts`.

---

## Medium

None that is new. See L1 for how deferred F17 interacts with the IR-M2 fix.

## Low

### L1. Any tenant member can still read every raw share token, so the IR-M2 role-per-type rule only limits minting (deferred F17, interaction worth recording)

`doc_tokens_select_tenant` gives every member SELECT on all columns, `token` included (checked with `column_privileges`).
- A receptionist cannot mint a prescription link (`share_type_roles`), but can `select token from document_share_tokens where resource_type='prescription'` and open any prescription link a doctor created in the last 7 days.
- The same works for appointment tokens (reschedule) and invoices.
- F17 (hash the tokens) is deferred to V2-05. The 01-08 closure note for IR-M2/AR-M2 should say this, so the gate does not treat role-per-type as complete.

### L2. The signed-draft lock's "reopened" state can be forged through the queue (new lock, but DB-level immutability is already deferred to P1-03)

- `isDraftLocked` (`features/consultation/service.ts:23-27`) treats a visit as reopened when it has `signed_at` and `status = 'in_consultation'`.
- `transitionQueueState(visitId, 'in_consultation')` (`features/queue/service.ts:169-178`, permission `appointments:edit`, which every role has) moves a completed, signed visit to `in_consultation`. It checks no status and writes no `visit_revisions` snapshot.
- A doctor, or a receptionist together with a doctor, can then edit a signed record through `saveConsultationDraft` and set it back to `completed` through the queue. The amendment reason and revision snapshot that `reopenVisitForAmendment` requires (`:796-880`) are skipped.
- Direct PostgREST UPDATE on `visits` is already open to any member (`visits_update_member`; column UPDATE on `clinical_notes`, `status` and `signed_at`). So this is the app-level lock being incomplete, not a new hole.
- **Fix:** in the queue transition, allow `in_consultation` only from `waiting` and `completed` only from `in_consultation`, with the condition in the UPDATE filter. Optionally key the reopened state on an open revision row rather than on `status`.

### L3. Webhook sender binding ignores the country code (new code)

- `isSameMobile` (`app/api/webhooks/messaging/[provider]/route.ts:224-227`) compares `extractTenDigits` values. `extractTenDigits` keeps the last 10 digits of any number with more than 10 digits (`lib/utils/phone.ts:23`), so `+1 917 123 4567` matches the Indian `9171234567`.
- Exploiting it also needs a `replyMsgId` for a message sent to the victim, and a valid MSG91 secret on the webhook. So this is defence in depth only.
- **Fix:** normalise both numbers to E.164 and require `91` plus `[6-9]\d{9}`.

### L4. Late WhatsApp "cancel" or "reschedule" still acts on `waiting` and `in_consultation` visits (new fix covers only confirm)

- The cancel branch (`route.ts:327-332`) cancels any visit that is not cancelled or completed.
- `consume_reschedule_token` (`000021:481`) can move a `waiting` or `in_consultation` visit to another day.
- The confirm fix (AR-L1) rejected exactly this "late reply" pattern. Apply the same `booked`/`confirmed`-only precondition to cancel and to the reschedule issue/consume path.

### L5. `deleteLabDocument` acts on the stored path without the new patient-path check and audits that path

- `features/labs/service.ts:343-388`: `getDocumentSignedUrl` gained `isPatientStoragePath`, but delete did not.
- The audit metadata still holds `storage_path` and `title`. The key embeds the patient's name (`formatAmendedFilename`). AR-L5 removed the same field from the v1 lab-order audit for this reason.
- With the Supabase provider, storage RLS confines the delete to the member's tenant. With R2 (bucket-wide credentials, AR-L7, deferred) it would delete any key.
- **Fix:** add the same check and drop `storage_path` from the audit metadata.

## Info

- **I1.** `consume_reschedule_token` serialises only patient-vs-patient reschedules for a doctor. Staff booking paths do not take the same advisory lock, so a staff booking can still race a patient reschedule into a double booking.
  - If `v.doctor_id` is NULL, the lock key is NULL and `pg_advisory_xact_lock` is strict, so no lock is taken, and `o.doctor_id = NULL` disables the overlap check. Low impact.
  - Doctor hours and blocks are deferred (AR-L2, F16).
- **I2.** New code `app/api/v1/visits/[id]/route.ts` (the `updateErr.message` branch) still returns database text to the caller. Behind the switch.
- **I3.** About 94 `error: …message` returns remain across `features/`, `app/` and `lib/`, e.g. `reopenVisitForAmendment`, `"Failed to create audit revision record: " + revErr.message`. These are outside IR-L2's listed scope and owned by V2-03 P1-25. Recorded so they are not mistaken for fixed.
- **I4.** The webhook reschedule notification falls back to `from` (the phone number) when the patient name is missing (`route.ts`, `Patient ${… || from}`). A tenant-scoped notification, but a phone number in UI text.

## Checked and holding

**Kill switch**
- Trailing slash and exact `/api/v1` are covered.
- Letter case: Next's app-file lookup is case-sensitive.
- `.png`/`.svg` suffixes: the extra matchers cover them (F19).
- HEAD and OPTIONS run the middleware.
- `//` and `\` get a 308 to the normal path.
- On-demand-revalidate skips middleware, but only with the preview secret.
- No rewrites are configured.
- The env schema refuses `API_V1_ENABLED=true` with `NODE_ENV=production`, and `apiV1Enabled()` also fails closed in production.

**Lab path validator (`lib/storage/tenant-path.ts`)**
- It refuses `%`, `\`, control characters, empty segments, `.`/`..` segments and leading `/`.
- Unicode look-alikes (`．．`, `∕`) are not normalised by Supabase storage or S3, so they stay inside the prefix.
- `?` and `#` can only shorten the key within the patient prefix.
- An uppercase `patient_id` gives a key the DB check later refuses, so nothing is signed (no gain).
- The patient and visit are verified in the key's tenant.

**v1 visit lock:** checked before the write and repeated in the UPDATE filter (`neq completed`, `signed_at is null`). Zero updated rows gives 409, so there is no TOCTOU window.

**Sign-off claim (`completeAndSignConsultation`):** the conditional UPDATE with `.select()` and a length check stops a concurrent double sign. The non-atomic Rx sealing is F18 (deferred).

**Draft lock race:** the UPDATE filter repeats the lock.

**Share tokens**
- `create_share_token` and `revoke_share_token` take the tenant from the resource or token row, look up the role in that tenant, and audit inside the function.
- A cross-tenant id gives `not_found`.
- Revoking an already revoked token is idempotent and writes no second audit row.
- No authenticated INSERT/UPDATE/DELETE on `document_share_tokens`.
- `share_type_roles`, `share_token_resource` and `share_resource_tenant` are not executable by anon or authenticated (`has_function_privilege` checked).

**Referral target guard (`referrals_target_update_guard`)**
- It compares the whole row minus status, `acknowledged_at` and `updated_at`, and allows only `sent` → `acknowledged`.
- The target tenant has no DELETE or INSERT path into the originating tenant.
- v1 referral PATCH filters on the originating `tenant_id`.
- Referral letters are derived in the DB (`share_token_resource`) and in the app (`getReferralSignedUrl`), and the stored column is ignored.

**Membership guard**
- `memberships` has a single user trigger.
- `authenticated` can UPDATE only the 7 profile columns (`signature_url`, `role` and `user_id` are not granted).
- The guard keys on `OLD.user_id` and `OLD.role`, so neither can be swapped mid-update.
- A NULL `user_id` falls into the restricted branch.
- `change_member_role` (role column only) is unaffected.
- No service-role path in a request updates `memberships`.

**Reschedule**
- Horizon checked in the DB (90 days) and the route.
- Lookup clamped to one day.
- A new link revokes older unused links.
- `reschedule_token_visit` requires `access_count > 0`, so a superseded link cannot trigger notifications.
- The advisory lock is taken before the overlap check (VOLATILE plpgsql, so each statement gets a fresh snapshot).

**Schedule CHECK:** `is_valid_weekly_schedule` refuses non-objects, unknown days, non-boolean `enabled`, non-array or more than 8 shifts, non-`HH:MM` times and `start >= end`. Slot length is bounded to 5..120. Both constraints are VALIDATED.

**`search_medicines`:** the schema is quoted with `quote_ident`, `search_path` stays `''`, and the auth check is unchanged.

**Regressions:** none found.
- `create_share_token` keeps every 000020 check, adds the role rule and audit, and keeps the grants.
- The prescription share path dropped the 000020 fallback `<tenant>/<rx>.pdf`. That is functional, not security: an Rx with no stored PDF now cannot be shared.
- IR-L3: a non-owner's owner/admin role change is refused before any write.

## New vs deferred

| Item | Status |
|---|---|
| H1 encoded-dot share signing | **New**, incomplete AR-M1 fix. Fix in V2-01. |
| H2 encoded-path kill-switch bypass | **New**, 01-05 code. Fix in V2-01. |
| L1 raw tokens readable | Deferred F17 (V2-05). Note the interaction in the IR-M2 closure. |
| L2 queue forges reopen state | New app-level gap. DB immutability is P1-03 (deferred). |
| L3 country code | New, defence in depth. |
| L4 late cancel/reschedule | New, consistency with the AR-L1 fix. |
| L5 delete path and audit | New, consistency with AR-M1/AR-L5. R2 part deferred (AR-L7). |
| I1–I4 | I1 partly deferred (AR-L2, F16). I3 deferred (V2-03 P1-25). I2 and I4 are new, minor. |
