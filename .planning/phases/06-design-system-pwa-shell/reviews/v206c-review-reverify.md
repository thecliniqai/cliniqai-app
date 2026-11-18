# V2-06 06-09c adversarial re-verification: H-AUTHOUT and M-REMOVED

- Commit: `de553cd` (branch `v2/phase-06-design-system-pwa-shell`).
- Isolated re-verifier with fresh context. Private detached worktree, `npm ci`, local stack only.
- Synthetic users and clinics were created by the probe and deleted afterwards. A DB check finds 0 `RV A/B` tenants left.
- No build or serve was needed, so the e2e lane lock was not taken.
- `06-09c-REVIEW-FIXES.md` was read only after my own probes.

## Method

The probe is `tests/zz-rv/rv.spec.ts`. It was private and never committed; the worktree has been removed. Here is how it works:

- It signs in a real seeded user through an `@supabase/ssr` `createServerClient` backed by an in-memory cookie jar. This is the same cookie path the app uses.
- It injects Auth failures with a `global.fetch` wrapper:
  - on `/auth/v1/user` when the access token is unexpired;
  - on `/auth/v1/token?grant_type=refresh_token` after the cookie session's `expires_at` is moved into the past.
- It calls the real `GET /api/session-status`, `resolveServiceContext()` and `proxy()`.
- Run result: 31 tests passed. The log is in the scratchpad (`rv-run1.log`).

## H-AUTHOUT: PARTIAL

### Original reproduction: fixed

With an unexpired token, a failing `/auth/v1/user` now gives `503 {"error":"unavailable"}` and the session cookies are kept. This holds for:

- network error (`TypeError`)
- AbortError
- 503, 500 (JSON) and 520
- 429 and 408
- a non-JSON 403

A session revoked for real (admin global sign-out) still gives 401, so the fix does not fail open.

### Refresh path: same outcome as the original finding (High)

The session-status route, the proxy and every server action and page call `auth.getUser()` or `getClaims()`. When the access token has expired, these refresh first, and the refresh failure is handled inside auth-js 2.117.2 before `isDefinitiveAuthRejection` ever sees the error. `_callRefreshToken` runs `_removeSession()` for any error that is not an `AuthRetryableFetchError` once the access token has expired. A 429 is an `AuthApiError`, so it falls into that branch.

| Refresh answer | Route, first poll | Cookies after | Route, next poll | Proxy on a page GET |
|---|---|---|---|---|
| network, 503, 500 | 503 | kept | 503 | 307 `/login`, 0 cookie deletions |
| **429** | 503 | **deleted** (`setAll`) | **401 → `hardSignOut("expired")`** | 307 `/login` + **auth cookie deleted** |
| 400 gateway JSON (no code) | 401 | deleted | 401 | 307 + deleted |
| 404 JSON (Kong "no Route matched") | 401 | deleted | 401 | 307 + deleted |

**Impact.** A rate-limited `/token` endpoint signs out every device whose one-hour access token expires during the rate limiting:

- The proxy deletes the device's auth cookies.
- `/login`'s `onLoginArrival` then sees no session cookie, purges the device and tells every other tab to leave.
- The next session-status poll answers 401, so `hardSignOut("expired")` runs.

Within an hour of rate limiting this reaches the whole fleet. The triage acceptance named 429 explicitly as "leaves the device signed in". The fix's tests only cover `/user`, never the refresh. 429 on `/token` is realistic for two reasons:

- GoTrue rate-limits token refresh per IP.
- All server-side refreshes come from the hosting egress IPs, not the users' IPs. The same happens during a retry storm while an outage recovers.

Severity: **High (H-AUTHOUT-R1)**, the same destructive outcome reached through another route.

**Fix.** In `proxy.ts`, and in `lib/supabase/server.ts` for route handlers and actions:

- Buffer `setAll`.
- After `getClaims()`/`getUser()`, drop auth-cookie deletions unless the error is definitive, using the same `isDefinitiveAuthRejection`. A 429 or 408 must never delete the cookies.
- Treat that request as "auth unavailable" rather than signed out: the route answers 503; a page GET either does not redirect to `/login`, or redirects without deleting cookies.

**Test.** With an expired cookie session and `/token` answering 429:

- the proxy and the route keep the cookies;
- the route answers 503 twice in a row;
- an e2e resume keeps the page.

### Other routes checked

- **Low (L-R1): definitive-rejection classifier is too broad.** Any JSON 4xx on `/user` counts as definitive, which covers a gateway 400, a Kong 404 ("no Route matched") and Kong 401 ("Invalid API key"). Each gave 401, then sign-out.
  - The 401 case means a publishable-key rotation or misconfiguration would sign out and purge every device.
  - Fix: treat as definitive only `AuthSessionMissingError` (which auth-js maps `session_not_found` to) and GoTrue's known codes (`bad_jwt`, `user_not_found`, `no_authorization`, `refresh_token_not_found`, `refresh_token_already_used`, `user_banned`). Treat an uncoded 4xx as retryable.
- **Low (L-R2): outage with an expired token sends page navigations to `/login`.** The proxy treats a retryable refresh failure as signed out, so every GET page navigation (including RSC client navigations) gets a 307 to `/login`.
  - The cookies are kept, so `/login` does not purge, and the device recovers after the outage. Any input on the page being left is lost.
  - Separately, the `(today)` page swallows `AuthUnavailableError` in `assertPageClinicFull` and then calls `getUser()` itself, so `if (!user) redirect("/login")` fires. That is a `/login` redirect on a client navigation even with an unexpired token.
  - Fix: render a retry state instead of redirecting when the claims error is retryable. In `withPageAuth`, rethrow `AuthUnavailableError`.
- **Low (L-R3): retry amplification.** For each request during an outage with an expired token, auth-js retries the refresh with backoff for about 25–30 s. The probe measured about 25 s for each proxy call, and it happens twice per poll (proxy, then route).
  - The client gives up after 10 s, so the abandoned server work piles up.
  - The new client back-off (15 s, 30 s, 60 s, 120 s) raises poll frequency during an outage and has no jitter.
  - Fix: add jitter; on the server, cap the refresh retry (abort the fetch after a few seconds).
- **Server actions.** `AuthUnavailableError` answers the generic failure, never `unauthenticated`, so no `UNAUTHENTICATED` sign-out comes from a `/user` outage. The refresh-429 route above still applies, because actions use the same cookie adapter.
- **Fail-open.** None found: a revoked session gives 401, and a missing session gives `AuthSessionMissingError`, then 401.

## M-REMOVED: PARTIAL

### Original reproduction: fixed

| Probe | Result |
|---|---|
| R1: dual member A+B, cookie = A, removed from A | 200 before → **403 `no_membership`** after; the server action answers `reason: no_membership` |
| R2: suspended in A | 403 |
| R5: forged cookie naming a foreign clinic | 403 for the forger only; another user's session (owner A) is unaffected (200); a junk or empty cookie is ignored (200) |
| R6: removed from the last clinic | 403 |

### Cookie-less route: still a silent switch (Medium, M-REMOVED-R1)

No app code writes `clinic_active_tenant`; the switcher is P1-12, planned for V2-08, and the fix record itself notes this. The fix therefore protects only devices that carry a cookie, which today means only tests.

Probe R3 shows the path that real devices take:

| Step | Session-status answer | Effect on the client |
|---|---|---|
| Receptionist of A only (no cookie) | 200 | — |
| Added to clinic B | 409 `clinic_selection_required` | ignored |
| Removed from A | **200, B's level** | no sign-out |

After the removal, `resolveServiceContext()` resolves **B**.

The outcome is the original M-1: A's patient data stays on screen with no conceal or purge, and the next navigation and actions run against B under A's shell (wrong-clinic writes). The precondition is narrower (a second membership gained after the page loaded), but the 409 phase can last as long as the page stays open, and it is the normal "staff moved between clinics" sequence.

The e2e `09-outage-and-removal` removal case passes only because the harness sets the cookie.

**Fix.** Pin the clinic for each device without needing the switcher. For example, `/api/session-status` (which runs on every shell start) writes `clinic_active_tenant` (HttpOnly, SameSite=Lax, path /) whenever it resolves a clinic and none is set. From then on, any change is a 403. The sign-out route already deletes it. Alternatively, the layout can render an opaque per-session clinic tag that the poll compares.

**Test.** Start with A only and no cookie. Poll once (the cookie gets set), add B, remove A, then poll again: expect 403.

### Other removal routes

- **Removal while offline.** No poll can run; on `online` the check runs and gets 403, which leads to `hardSignOut("removed")`. Covered by code.
- **Removal racing a switch.** Every switch to a clinic the user is still a member of answers 200 (A, B, and B in upper case). A switch to the removed clinic answers 403. No race gives access.
- **Other open tabs.** These are covered by `hardSignOut`'s broadcast.
- **bfcache.** Not separately probed. Pages are `no-store`, and on restore the `visibilitychange` check would answer 403.
- **Low (L-R4): removal from the last clinic on a full page load.** The layout redirects to `/clinic/new` (the `NoClinicMembershipError` branch) instead of signing out and purging. The shell's watch does not run there, so device state stays until the next sign-out. The poll path on an open page does answer 403.

## Legitimate paths

These held at the route level (probes, no browser):

- **Normal poll:** 200 `{deploymentId, accessLevel: full, redirect: null}`.
- **Dual member switching** A ↔ B by cookie: 200 and 200.
- **Signing in again after removal** from A, with no cookie: 200, opening B with no loop.
  - With a stale cookie A it would answer 403. The loop is avoided only because the sign-out route and the client fallback expire the cookie; I did not re-run the e2e for that.

## Summary

| Finding | Status | Residual |
|---|---|---|
| H-AUTHOUT | **PARTIAL** | **High H-AUTHOUT-R1**: a 429 (or uncoded 4xx) on token refresh deletes the cookies (auth-js `_removeSession`). The device is then signed out and purged. Lows L-R1, L-R2, L-R3 |
| M-REMOVED | **PARTIAL** | **Medium M-REMOVED-R1**: nothing writes the active-clinic cookie, so the cookie-less path (A only, then +B, then −A) still switches silently to B. Low L-R4 |
