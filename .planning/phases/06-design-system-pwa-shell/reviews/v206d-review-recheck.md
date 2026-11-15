# V2-06 06-09d adversarial re-check: H-AUTHOUT-R1 and M-REMOVED-R1

- Commit: `f9298e0` (branch `v2/phase-06-design-system-pwa-shell`).
- Isolated re-checker with fresh context. Private detached worktree, `npm ci`, local stack only. The worktree has been removed.
- No build or serve was needed, so the e2e lane lock was not taken. Every probe ran at route, proxy and service level against real local GoTrue and PostgREST.
- Synthetic users and clinics only. The vitest global teardown removed them after each run ("verified none remain"). Afterwards a DB check finds 0 tenants named `Synthetic RV%`.
- `06-09d-REVERIFY-FIXES.md` was read only after my own probes.

## Method

1. I ran the implementer's `tests/auth/session-auth-reverify-db.spec.ts`. Result: 57/57 passed (log `rv2-theirs.log` in the scratchpad).
2. I wrote a private probe spec, `tests/zz-rv2/rv2-db.spec.ts`. It was never committed and was deleted with the worktree.
   - It reuses the same harness: an in-memory cookie jar behind a mocked `next/headers`, and a `globalThis.fetch` fault wrapper.
   - It adds fault modes the shipped spec does not have:
     - **slow but processed:** GoTrue handles the request at once (the token rotation happens), but the answer arrives 2.5 s or 4.5 s later;
     - **raw GoTrue refresh-token replays;**
     - **slow `PUT /auth/v1/user`.**
   - It also adds real-GoTrue fail-open cases (deleted user, banned user, real `refresh_token_already_used`, a session with no refresh token) and the pin edge cases.
   - Results: 16/16 cases ran (logs `rv2-run1.log`, `rv2-run2.log` and `rv2-run3.log`).
   - The run reports 4 "unhandled rejection" `AuthSessionMissingError`s. They come from probe B4's contrived cookie (auth-js's internal deferred promise) and are not app behaviour.

## H-AUTHOUT-R1: CLOSED

### Non-definitive answers keep the session

The shipped spec covers every failure the brief lists, on both the refresh and `/user`:

- network error, abort, 503, 500, 520, 429, 408;
- an uncoded 400, Kong's 404 and 401;
- an HTML 403;
- `no_authorization`.

For each of these, all of the following held:

- **Route:** 503 on two polls in a row, and the cookies stayed in the jar.
- **Proxy:** 200, never a `/login` redirect, 0 auth-cookie deletions, the request marked `unavailable`, and a no-store response.
- **Server action:** answers `reason: unavailable` and deletes no cookies.
- **Sign-out route:** still signs this device out.

Under the proxy's mark, nothing refreshes a second time (0 refresh calls). The layout and Today throw `AuthUnavailableError`, never `/login`.

### No fail-open (my probes, real GoTrue answers, no injection)

| Probe | Result |
|---|---|
| B1: user deleted (admin) | Unexpired token: route 401. Expired token: route 401, jar cleared. Proxy: 307 `/login`, 1 deletion |
| B2: user banned | Unexpired token: route 401. Expired token: route 401. Proxy: 307 with deletions. A raw refresh answers `400 user_banned` |
| B3: real `refresh_token_already_used` (grandparent token replayed after the 10 s reuse interval) | Route 401, jar cleared. Proxy: 307, 1 deletion |
| Real revoked session; synthetic `refresh_token_not_found` (shipped spec) | 401, and the proxy answers 307 with deletions |
| B4: session cookie without a refresh token | Proxy 307 (no deletion). Route 401, so the client signs out. A junk cookie gets a proxy 307 |
| B5: inbound `x-clinicos-auth-state: unavailable` forged while Auth is healthy | Stripped: the forwarded mark is `null` |

### Remaining code paths that build a client or call auth-js outside the transport

Searched for `createServerClient`, `createBrowserClient`, supabase-js `createClient` and every `auth.*` call. The server cookie clients are `proxy.ts` and `lib/supabase/server.ts`, and both use the transport. Through `createClient()`, that covers every route handler, server action, page, the PDF and export routes, `features/auth/service.ts`, `features/settings/service.ts`, and the invite and clinic actions.

The remaining clients:

- `createPublicClient()` has no session.
- `lib/supabase/system.ts` uses the service role and has no session.
- The browser client in `lib/supabase/client.ts` is not covered (L-N3 below).

None of the direct `getUser()` callers can sign anyone out:

- `cabin`, `join`, settings, invite and clinic actions return a text error;
- the PDF and export routes answer 503 for `unavailable`.

### Timing: does the 3.5 s cap break slow but working refreshes?

| Probe | Result |
|---|---|
| A1: refresh answered after 2.5 s | Route 200, rotated session stored |
| A2: GoTrue rotates, answer arrives after 4.5 s (lost) | Proxy: 200, `unavailable`, 0 deletions, 3.5 s. **11.5 s later** (past the 10 s reuse interval) the **old** refresh token is still accepted: proxy 200 with a new cookie, route 200. GoTrue's parent-of-the-active-token rule covers a rotation the transport aborted, so a lost rotation does not sign out |
| A3: raw grandparent replay after 11 s | `400 refresh_token_already_used` (expected GoTrue behaviour). The transport cannot produce this, because a lost rotation is never handed to the device and so never rotated again |
| Hang, network or 503 (shipped spec) | Proxy 3.0–3.5 s plus route 3.0–3.5 s, which stays under the client's 10 s |

**Verdict:** no destructive outcome remains. Residual costs are availability only (L-N1, L-N2).

## M-REMOVED-R1: CLOSED

| Probe | Result |
|---|---|
| R3 cookie-less (shipped spec): A only, poll pins A, then added to B, then removed from A | 403; the action answers `no_membership` |
| D2: dual member A+B, no cookie | No header: 409, no pin. Header A: 200, pins A. Removed from A, then a poll with a forged header B: **403** (the cookie wins) |
| D3: header forged to a foreign clinic C, no cookie | 403 for the forger only and **no pin set**. C's owner on their own session: 200. Junk header: ignored (200). Upper-case own id: 200, pin stored in canonical lower case |
| D4: cookie A plus forged header C | 200 (header ignored while pinned) |
| D4: cookie forged to C plus header A | 403, which signs out the forger's own device only. The sign-out route expires the pin; signing in again gives 200 |
| D1: cookie attributes | `Path=/; Max-Age=34560000; HttpOnly; SameSite=lax`, plus `Secure` on https and none on http |
| R1/R2/R6 (shipped) | Removed or suspended with B left: 403. Removed from the last clinic while pinned: layout `MembershipEnded`, route 403 |

A forged value cannot read another clinic's data. `getActiveMembership` only matches the user's own active memberships, and the DB's `authz.active_tenant_id()` does the same. Any lockout is limited to the forger's own device.

**Legitimate paths:**

- **Single-clinic user:** 200 and pinned.
- **Dual member:** pinned through the header, no loop.
- **Sign-in after removal through the sign-out route:** 200, no loop.

One caveat for sign-in after removal: see L-N4.

## New findings

No new High or Medium. Four Lows:

### L-N1 (Low): the per-client Auth budget also covers non-session calls

The budget applies to `PUT /user` and `/logout`, so a password change can be reported as failed after GoTrue applied it.

- **Why:** `createAuthTransport` starts one 3.5 s deadline at the client's first Auth call (often the JWKS fetch inside `getClaims`). It then aborts, or answers with a synthetic 408 without sending, **every** later Auth call, including `updateUser`.
- **E1:** `changePassword` with the pwned check at its 1.5 s cap, and GoTrue answering `PUT /user` after 2.2 s (already processed). The result is `{"ok":false,"code":"unknown","message":"We couldn't change your password, try again"}`, yet the **password actually changed**. `signOut({scope:"others"})` and the success path never ran.
  - Realistic triggers: the "password changed" notification email is ON (AUTH_REDESIGN), and hosted GoTrue latency.
  - The user then retries with the old "current password" and fails.
- **E2:** 3.6 s of work before the PUT means the PUT is never sent: a failure, but no harm.
- The same applies to:
  - the best-effort `updateUser` metadata sync in `features/settings/service.ts`, which is skipped silently after a slow DB step;
  - `endRecoverySession`'s `signOut` calls. The UI does report "could not sign out your other devices".
- **Fix:** apply the budget and the abort only to the session-bearing calls (`GET /user`, the refresh grant, JWKS), or call `restartBudget()` before each separate Auth operation. Never abort a non-idempotent `PUT /user` mid-flight.

### L-N2 (Low/availability): a slow but working GoTrue makes the app unavailable instead of slow

- **Mechanism:** if GoTrue latency stays above 3.5 s, every device whose access token expired, and every request on an HS256 project (where `getClaims` calls `/user`), gets "unavailable" (the error boundary or a 503) until latency drops. Before 06-09d these requests succeeded slowly.
- **Damage:** no sign-out, as A2 shows.
- **The budget can be larger:**
  - the route never refreshes again after the proxy, either because it is under the mark or because the cookies are now fresh;
  - so the 10 s client timeout allows roughly 6–7 s in the proxy.
- **Suggested change:** raise `AUTH_REQUEST_BUDGET_MS` for the proxy refresh, or keep it and document it as a deliberate trade-off.

### L-N3 (Low): the browser Supabase client on `/forgot-password` is outside the transport

- **The client:** `app/(auth)/forgot-password/page.tsx` creates the browser client on mount.
- **What it does:** auth-js `_recoverAndRefresh` refreshes an expired session from the (non-HttpOnly) auth cookies. On a 429 or an uncoded 4xx, `_callRefreshToken` runs `_removeSession()`, and that deletes the auth cookies through `document.cookie`.
- **The result:** a signed-in user who opens `/forgot-password` while `/token` is rate-limited is signed out. The next app request then goes to `/login`, where `onLoginArrival` purges the device.
- **Scope:** one page that signed-in users rarely visit. `/login` creates the client only at submit time.
- **Fix:** create the client lazily (at submit), or use `auth: { autoRefreshToken: false }` on the auth pages.

### L-N4 (Low/UX): a stale pin survives more sign-out paths than the fix record says

- **What the record says:** `06-09d-REVERIFY-FIXES.md` §3 limits the stale pin to the client fallback, when `/auth/signout` is unreachable.
- **D6:** the proxy's definitive sign-out also leaves `clinic_active_tenant`. A revoked or expired refresh token gives a 307 `/login` that deletes the auth cookies with `pinDeleted=false`, and `continueSignedOut` is the same.
  - This is the normal path when a staff removal revokes sessions while the device is closed, or after "sign out all devices" or a refresh-token expiry.
- **D5:** with A's pin left behind:
  - **A user of B only:** route 403 and layout `MembershipEnded` ("You no longer have access to this clinic. Signing you out…").
  - **A brand-new account with no clinic:** also `MembershipEnded` instead of `/clinic/new`.
- **Impact:** one spurious sign-out with a misleading message, after which the user signs in again and it works. No data exposure.
  - On a shared front-desk device, another user's pin also selects that clinic for a dual member who belongs to it.
- **Stale comment:** `lib/auth/hard-sign-out.ts` `expireAuthCookies` still says it clears the pin, but it cannot clear an HttpOnly cookie.
- **Fix:**
  - In `proxy.ts`, expire `clinic_active_tenant` whenever the request is definitively signed out (in `redirectToLogin` and `continueSignedOut`), or on any request that has no auth cookie.
  - Optionally bind the pin to the user (store `userId:tenantId` and ignore a pin for another user).

### Info

- **Before the first successful poll there is no pin:** a long Auth outage on page load, or an old pre-06-09d bundle that sends no header during the deploy window. In that window, server actions resolve the single membership without the pin. The precondition is narrow: the page loaded with A only, then the user was added to B and removed from A before any poll succeeded.

## Summary

| Finding | Status | Residual |
|---|---|---|
| H-AUTHOUT-R1 | **CLOSED** | Lows L-N1 (budget covers `PUT /user`: a password change reported as failed although applied), L-N2 (latency over 3.5 s means unavailable rather than slow), L-N3 (browser client on `/forgot-password` can still delete the cookies on a refresh 429) |
| M-REMOVED-R1 | **CLOSED** | Low L-N4 (stale pin after the proxy's definitive sign-out: one spurious `MembershipEnded`, and a new account misses `/clinic/new`) |
