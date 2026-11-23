# V2-09d request speed — adversarial security review

Scope: `git diff 0acb544c..HEAD` on `v2/phase-09d-request-speed` (HEAD 3b086857), excluding `.planning/phases/09E-caching-speed/`.
Method: read the diff and its callers, read auth-js 2.117.2 `getClaims`/`fetchJwk` and Next 16.4.6 `headers()`/request store,
and ran a temporary Vitest proof spec on the local stack only, using the harness of `tests/auth/session-context-db.spec.ts`.
The spec was deleted after the run, and its run data was torn down: "removed run data … verified none remain". Synthetic data only.

Counts: **Critical 0 · High 0 · Medium 1 · Low 2 · Hardening 4**.

---

## S-1 (Medium, PROVED): a session revoked elsewhere passes every Server Action guard, sensitive owner actions included, until its access token expires (up to 900 s)

- Where: `lib/auth/tenant.ts:213-236` (`getSessionClaims` → `getClaims()`, which verifies locally and never asks GoTrue);
  `lib/auth/tenant.ts:392-422` (`getActiveMembership`, where only `fresh` calls `confirmSessionAtAuth`); and every guard on top of it
  (`lib/auth/context.ts:45-60`, `lib/permissions/guards.ts:16-29`). `public.session_is_live()` (`supabase/migrations/000087_membership_status.sql:383`)
  exists, but nothing calls it: not the app, not any definer command.
- Before 09d: every action's `getActiveMembership()` called `auth.getUser()`. That call refused a session whose `auth.sessions` row
  was gone (sign-out everywhere, password change or reset with `signOut({scope:"others"|"global"})`, R-43 removal). It was the
  only liveness check in the system, and it is what satisfied AUTH_REDESIGN §3.5 step 3 in practice ("for the most sensitive
  actions … confirm that the JWT `session_id` has a row in `auth.sessions`").
- Now: page loaders (the approved deviation 2) and also **all Server Actions and route handlers** accept the revoked session.
  The only check left is the shell's 5-minute status poll, which runs on the client and so is not a server control.
- Proof (local stack): the owner signs in (session A) and A gets a context cookie. A second session of the owner calls
  `signOut({ scope: "global" })`. Then:
  - `session_is_live()` with A's token returns `false`.
  - `updateStaffMember({ role: "doctor" })` with A **and the cookie** returns `success: true`. Calls made: no Auth call,
    then `change_member_role` and `log_audit`.
  - `updateStaffMember({ role: "nurse" })` with A and **no cookie** (database path) also returns `success: true`, and the
    target's role in the database is now `nurse`.
  - Calibration: a direct PostgREST `rpc("change_member_role")` with A's raw JWT also succeeds. The database itself has no
    liveness check, so someone who has extracted the token could already do this before 09d.
- Impact: in the window that "sign out everywhere" or "change password" is meant to close (lost device, shared computer,
  stolen cookie jar), the holder can still use the full app UI. This includes role grants, staff removal, API key creation
  (`features/api-keys/actions.ts:27`, a credential that outlives the revocation), webhook subscription creation
  (`features/webhooks/actions.ts:28`, a PHI egress path that outlives it) and the DPDP export (`features/dpdp/export.ts:140`).
  These are not data reads that RLS cuts off: for a revoked owner session, membership is still active, so RLS allows
  everything. Removed members are not affected, because `memberships.status` cuts them off in RLS at once.
- Why Medium and not High: 09d adds no capability for someone who can lift the raw access token, since PostgREST accepts it
  anyway (AUTH_REDESIGN principle 5). The regression is at the app layer, and the design document requires this check for
  exactly these actions.
- Fix:
  1. Add `requireLiveSession()` (one `rpc("session_is_live")`, or `confirmSessionAtAuth`) to the §3.5(3) actions: role
     change and owner transfer, staff removal, API key create, webhook create and update, DPDP export, and sign-out-others.
  2. Better, also enforce it in the database: call `session_is_live()` inside `change_member_role`, `remove_member` and the
     DPDP export audit RPC, and in the INSERT policies of `api_keys` and `webhook_subscriptions`. That closes the raw-JWT
     path as well.
  3. Record the PO ruling on whether ordinary clinical writes may run on a revoked-but-unexpired session for up to 900 s.
     09D-NOTES records the deviation only for page loaders.

## S-2 (Low, reasoned): a role or access level up to 300 s old authorises side effects that the database never sees

- Where: `lib/auth/tenant.ts:142-150` and `:403-407` (the cookie path), consumed by `features/ai/actions.ts:43`
  (`requirePermission("consultations:edit")` and then a call to the external AI provider).
- Scenario: for up to 300 s after a cookie was issued, the device keeps the role and level the cookie recorded. This covers a
  member removed elsewhere, a doctor demoted to receptionist, or a clinic locked by a billing webhook. Every database read and
  write is still re-checked, and the removal, role and lock paths were checked: `tenant_ids_with`, `full_tenant_ids`,
  `active_tenant_id`. But a path that does work outside the database follows the TS guard only. The one such path in a
  request is `generateSoapAction`, which sends caller-supplied text to the AI provider.
- Today it has no UI caller and `AI_ENABLED=false`, so the exposure is minimal. It will matter once AI is switched on (cost,
  and clinical text sent for a removed member or a locked clinic).
- Fix: before any external side effect, check entitlement and role in the database (for example `my_entitlements` or a
  definer "may use AI" check), or call the guards with `fresh: true`. Add a lint or inventory rule: an action that calls an
  external provider must not rely on the cookie-backed context alone.

## S-3 (Low, accepted design, documented): a removed or demoted member's own device keeps the old navigation and access state for up to 300 s

- Where: `lib/auth/tenant.ts:403-407`. The role-edit, removal and settings `forgetSessionContext()` calls clear only the
  **actor's** device (`features/settings/actions.ts:93`, `features/staff/actions.ts:255`). The target's cookie stays valid
  until its `exp`.
- Effect: the target sees the old role's navigation, and the layout's `ActiveClinicMembershipEndedError` sign-out is delayed
  until the cookie expires or the next status poll. Data is refused at once (the implementer's removed-member test covers
  this, and the review confirmed it).
- Fix: none required. An optional improvement is a per-membership `context_epoch` (or `updated_at`) in the cookie, compared by
  a cheap query only on sensitive pages.

## S-4 (Hardening): `SESSION_CONTEXT_SECRET` quality checks

- Where: `lib/env.ts:568-574`. The check is length only (32 characters, so `"a".repeat(32)` passes), with no check that the
  value differs from `CRON_SECRET`, `JOBS_RUNNER_SECRET`, `ERROR_INGEST_KEY` or `SEND_EMAIL_HOOK_SECRET`, and it is optional
  on staging. Fail-closed behaviour is correct: unset means no cookie, and production refuses to boot without the secret.
- Fix: require at least 32 bytes of hex or base64url (64 hex characters), refuse reuse of another secret's value, and require
  it on staging once PO action P1 is done.

## S-5 (Hardening): the cookie has no `__Host-` prefix

- Where: `lib/auth/context-cookie.ts:28` and `:147-149`. A sibling subdomain of a future custom domain could set or shadow
  `clinic_ctx` for the parent domain. It cannot forge one, since the MAC and the uid/sid/pin binding hold, but it can force
  the database path or a denial of service.
- Fix: `__Host-clinic_ctx` when `secure` is set (Path=/ and no Domain already hold).

## S-6 (Hardening): `getClaims()` claim checks

- Where: `lib/auth/tenant.ts:217-236`. auth-js verifies the signature and `exp` but not `iss`, `aud` or `role`. With
  asymmetric project keys only GoTrue-issued user tokens are signed, so this is not exploitable today. A future custom
  access-token hook or a shared signing key would widen it.
- Also: a forged token with an unknown `kid` makes auth-js refetch the JWKS and fall back to `getUser()` on every request
  (amplification). This was already reachable through the proxy's `getClaims()` before 09d.
- Fix: refuse unless `claims.role === "authenticated"` and `aud` includes `"authenticated"`.

## S-7 (Hardening): the cookie is set on GET route-handler responses

- Where: `lib/auth/tenant.ts:335-346`. `issueContextCookie` runs in any route handler that resolves the context from the
  database, for example `app/api/invoices/[id]/receipt-pdf/route.ts`. The value is bound to uid/sid/pin, so a cached copy is
  useless to another user. Still, a `Set-Cookie` on a cacheable GET is a pattern to avoid.
- Fix: confirm `Cache-Control: private, no-store` on every route that can issue the cookie, or issue it only from
  `/api/session-status` and Server Actions.

---

## Attacked and found sound (no finding)

- **Forgery and MAC construction** (`context-cookie.ts:65-144`): HMAC-SHA256 over a domain prefix plus the exact base64url
  payload text, so there is no encoding ambiguity. The MAC is checked before parsing, with a length check and then
  `timingSafeEqual`. Exactly one `.` is accepted and the length is capped at 2048. The lenient base64url decoding of the MAC
  only makes the MAC string malleable, never the payload. Shape, role and level are checked against closed sets.
- **Replay**: refused for another user (`uid`), another session of the same user (`sid`; covered by the existing test), after
  sign-out or sign-in on the device (new `sid`; the signout route and the proxy also delete the cookie), and after the pin
  cookie changes (`pin` binding). `exp` and `iat` are inside the MAC, so the life is at most 300 s from the last database
  check, whatever Max-Age the client sets.
- **Issue timing**: `RESOLVED_KEY` is set only on the database path (`tenant.ts:410-420`), and the level comes from the
  database memo. When the cookie answered, the code returns before issuing. A cookie therefore never extends itself, and
  never carries a role or tenant that the database did not return in that same request.
  - Clinic switch while a status poll or another action is in flight: a stale cookie carries the old pin and is refused.
  - Unpinned status poll: it sets the pin and the cookie to the same `tid`.
  - Invite accept and clinic create call `forgetSessionContext()`.
  - A pin of `""` is issued only for a single-membership resolution. If a second membership appears, the database's
    `active_tenant_id()` returns null (fail closed).
- **Tenant from caller input**: none was added. The `SHELL_CLINIC_HEADER` is validated against the caller's memberships on the
  fresh path, as before. `x-clinicos-tenant` (R-42) is unchanged.
- **Service role**: none added to request paths. `getSystemDb` callers are unchanged.
- **Database re-check**: every write goes through the user JWT, and the database checks role and access with
  `tenant_ids_with`, `full_tenant_ids`, `change_member_role` and `memberships_profile_update_guard`. TS-only role checks
  (`updateStaffMember` owner-only, `createApiKey`) are also enforced in the database.
- **Memo leakage** (`request-memo.ts`): keyed by the `requestStore.headers` object. In Next 16.4.6, `makeUntrackedHeaders`
  caches per underlying headers, and a new request store means a new object. The codebase uses no `after()`, `"use cache"`
  or `unstable_cache`. Outside a request nothing is memoised (jobs, scripts). A static-render bailout is rethrown.
- **`getClaims()` expiry**: `validateExp` runs unless `allowExpired` is set, and the app never sets it. `alg` none or HS*,
  or a missing `kid`, falls back to `getUser()`. A token without `session_id` never matches, and no cookie is issued for it.
- **Secret missing or empty**: production refuses to boot. When `serverEnv()` throws, `contextSecret()` returns null and the
  cookie is off, so the request reads the database (fail closed). Placeholder (`not-real`) secrets are refused on deploy tiers.
- **Cookie flags**: HttpOnly, SameSite=Lax, Path=/. Secure is set on https and on production hosts other than loopback, so
  staging and production on Vercel get it. The proxy deletes the cookie with Max-Age 0 from the same https origin.
- **Logging**: no line logs the cookie, claims, email or metadata. The new lines log only `errorTag` and `requestId`.
