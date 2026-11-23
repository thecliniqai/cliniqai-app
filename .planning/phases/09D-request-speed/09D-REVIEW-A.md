# V2-09d request speed: independent code review A

Reviewer: Claude (fresh context, no implementer reasoning). Scope: `git diff 0acb544c..HEAD` on `v2/phase-09d-request-speed`, excluding `.planning/phases/09E-caching-speed/`. Read-only; nothing run against hosted services; no `.env*` read. Findings were formed from the code first; `09D-NOTES.md` was read afterwards only to mark declared deviations.

Verified against the installed sources (Next 16.4.6, auth-js 2.117.2):
- `headers()` resolves to one object per request (`makeUntrackedHeaders` caches by the request store's headers), so the `requestMemo` scope is sound and cannot leak between requests or users.
- `getClaims()` verifies ES256 tokens locally against a process-wide JWKS cache (`GLOBAL_JWKS`); for HS256 or a `kid`-less token it falls back to `getUser(token)`. A JWKS network failure surfaces as an `AuthRetryableFetchError` (not a raw throw), so the outage classification in `readSessionClaims` holds.
- `cookies().set/delete` in a Server Action is reflected by later `cookies().get` in the same request, and sets `workStore.pathWasRevalidated` (see A-3).
- The cookie format itself (`lib/auth/context-cookie.ts`) is sound: HMAC checked in constant time before JSON parsing, size cap, shape checks, lifetime cap, `uid`/`sid`/`pin` binding, never a cause of a wrong-user context. A missing secret, a wrong secret or a malformed value all degrade to the database path; none throws.

Counts: Critical 0, High 1, Medium 5, Low 9 (total 15).

---

## High

### A-1 (High): a revoked session now passes every Server Action, route handler and page for up to 900 s, including the most sensitive ones

**Where:** `lib/auth/tenant.ts:392-394` (`getActiveMembership` calls `getUser` only with `fresh`), `lib/auth/context.ts:46`, `lib/permissions/guards.ts:26`, `app/api/patients/[id]/export/route.ts`, `features/staff/actions.ts:250-255`, `features/settings/actions.ts:80-93`.

**Failure scenario:** an owner's device is stolen; the owner signs out everywhere or resets the password (`signOut({scope:"others"/"global"})`). The thief's access token is still unexpired for up to 15 minutes. Before 09D, every guarded entry point went through `getActiveMembership` -> `auth.getUser()`, so the next action, export or page load was refused at once with `Unauthenticated`. Now `getClaims()` verifies the token locally and everything passes: DPDP patient export (`exports:create`), staff removal, role edits, clinic settings, billing, until the token expires. NOTES deviation 2 frames this as "page loaders no longer detect a revoked session"; it is wider: Server Actions and route handlers lost the same check, and the only compensation (the `/api/session-status` poll) runs in the *legitimate* browser, not the thief's.

AUTH_REDESIGN principle 5 (RLS membership is the data stop) does cover the *removed member* case. It does not cover a revoked session of a still-active member, and AUTH_REDESIGN §3.5 step 3 names exactly the "most sensitive actions (data export, ... role grant, owner transfer)" as needing a session-liveness check. `public.session_is_live()` was built for this (migration 000087) and has no caller in `app/`, `features/` or `lib/`. Before 09D the `getUser` side effect gave that check for free, so this is a regression of an unstated property.

**Fix:** keep the fast path, add a liveness check for a closed list of sensitive permissions. Either `requirePermission(..., permission, access, { fresh: true })` / `requireServiceContext` with `fresh` for `exports:create`, `clinic:manage`, staff remove/invite/role, owner transfer and billing mutations (one `getUser`, memoised per request, so one extra Auth call only on those paths), or call `rpc("session_is_live")` there. Add a DB test: revoke the session, then call `exportPatientDpdpArchive` / `removeStaff` and expect a refusal.

---

## Medium

### A-2 (Medium): the cookie makes the *role* stale for app-layer authorisation, not just navigation; RLS does not catch role-only gates

**Where:** `lib/auth/tenant.ts:403-408`, `lib/auth/context.ts:46-48`, `lib/permissions/guards.ts:26-27`.

**Failure scenario:** an owner demotes an admin to nurse (`updateStaffMember`) or transfers ownership. The demoted user's device holds `clinic_ctx` with the old role for up to 5 minutes (the poll does not shorten this: `fresh` re-reads the membership but the role-guard callers use the non-fresh path). In that window `assertPerm(membership.role, ...)` still passes for gates that exist only in the app: `exports:create` (owner only, reads under member-wide RLS), billing reports, staff and clinic-settings reads. The removed-member proof in `session-context-db.spec.ts` shows the DB refuses reads for a *removed* member; it does not show the same for a *demoted* one, which keeps `memberships.status = 'active'`. NOTES "Risks" calls this "previous role's navigation or access state"; it is authorisation.

**Fix:** same mechanism as A-1: a sensitive-permission set resolved with `fresh` membership (skip `contextFromCookie`), or an explicit role re-read in the guard for those permissions. Also have `updateStaffMember` bump something the target's next request sees (a `role_version` in the cookie would let it be rejected), or accept and document 5 minutes per permission class.

### A-3 (Medium): issuing the cookie inside a Server Action makes Next treat the action as a revalidation (extra full render, router-cache flush)

**Where:** `lib/auth/tenant.ts:335-346` (`issueContextCookie`), reached from `getTenantAccessLevel` (`:148`) in every action guard.

**Failure scenario:** Next's `MutableRequestCookiesAdapter.wrap` sets `workStore.pathWasRevalidated = ActionDidRevalidateStaticAndDynamic` on any `cookies().set/delete` (`node_modules/next/dist/server/web/spec-extension/adapters/request-cookies.js:125`). An action that would otherwise return only its result (no flight payload) now re-renders the current route and invalidates the client Router Cache, once per cookie TTL on the first action after the cookie expired. That re-render repeats the page's data reads (the very calls 09D set out to remove), can reset transient UI around autosave/consultation actions, and is invisible in `session-context-db.spec.ts` (the cookie jar is mocked). It also means `forgetSessionContext()` calls cost a refresh by design.

**Fix:** issue the cookie only from `/api/session-status` (already a fresh DB check that sets it with the right pin) and drop the in-action issuance, or accept it and add an e2e that measures an action's request count and checks no visible reset (the perf report measures only Check-in). If kept, document it in the NOTES design section.

### A-4 (Medium): the rewritten "revoked session" spec asserts nothing positive for the revoked case

**Where:** `tests/auth/page-revoked-session.spec.ts:101-110` (the `it.each(PAGES)("revoked session: ... never throws 'Unauthenticated'")` block).

**Failure scenario:** the original spec proved "revoked session -> `redirect('/login')`" per page. The replacement runs each page with the still-valid token and asserts only that the error message is not `"Unauthenticated"` and, `if (err !== null)`, that any error is a Next redirect/not-found. If the page renders (`err === null`) there is no assertion at all, so the test passes for a page that renders data, redirects anywhere, or 404s. It would stay green if the 05-11c false-`request.error` regression returned in any other shape. The intentional behaviour change is declared, but the test no longer pins an outcome.

**Fix:** pin the outcome per page (renders with the user's own data, or redirects to a named path) and add one negative control (a page that must still throw/redirect with a truly missing session, which the first block covers). Remove the `if (err !== null)` conditional.

### A-5 (Medium): the PR-lane budget spec has several CI reliability hazards

**Where:** `tests/e2e/support/kong-calls.ts:55-59, 94-113`, `tests/e2e/shell/request-budget.spec.ts:41-75`.

1. It depends on the `docker` CLI and the fixed container name `supabase_kong_clinicos` (derived from `project_id = "clinicos"`). A runner or a dev machine where `docker logs` is not permitted, or a renamed project, fails the test rather than skipping. CI e2e runs `supabase start` on `ubuntu-24.04` so it should work there, but the failure is on the e2e job that is a required check.
2. `readKongLog` returns `stdout + "\n" + stderr` (two streams concatenated, not interleaved). The window is computed by line index of the two markers; this is only correct while both markers and every access line are on the same stream. Any Kong error-log line that contains a marker path would put one marker in the stderr tail and break the order check (`end < start` throws).
3. The zero-call assertions (`/auth/v1/user` 0, `my_tenant_access` 0, `memberships` 0 on Patients) only hold if `clinic_ctx` already exists. It is issued by the on-load `/api/session-status` call, which runs after hydration and `networkidle` is only a heuristic; the two warm-up navigations are the only protection. A slow status call on a CI runner (the lane has been measured at 2.1x) makes the first measured navigation read the database -> red -> retried (CI retries: 2) -> green, which CLAUDE.md classifies as a defect.
4. `countKongCalls` counts every non-`Mozilla` request as "server", so any other server-side activity inside the window (a late request from the previous test's page, the app's own jobs/instrumentation traffic) inflates the zero counts. `workers: 1` helps; it does not exclude the previous test's tail.
5. A failure in `docker logs` is only retried for the end marker (10 s), not for a transient `docker` error.

**Fix:** (a) assert precondition inside the spec, e.g. read the context cookie from `context.cookies()` and wait for it before the measured window, and fail with a clear message if absent; (b) skip with an explicit reason when `docker info` is unavailable locally but fail in CI (`process.env.CI`); (c) take the container name from the same constant as the stack scripts; (d) read the two streams with `--timestamps` and sort, or pass `2>&1` through a shell, to preserve order; (e) keep `retries: 0` for this spec.

### A-6 (Medium): `review2-fixes-db` "reschedule links" is date-dependent; the same defect is present in the +11 days case

**Where:** `tests/security/review2-fixes-db.spec.ts:309-310` (+13 days, 05:00 UTC), and `:386-387` ("a confirmed visit can still be rescheduled", +11 days, 07:00 UTC).

**Cause:** both pick "today + N days" at a fixed UTC hour, but the seeded doctor's default availability has no Sunday, so the command answers 409 (no slot) when the target day is a Sunday. +13 is a Sunday on Mondays (the observed failure), and by the same arithmetic +11 is a Sunday on Thursdays (inferred, not run). The +9 case expects a refusal, so it is unaffected. A day-of-week-dependent suite is a CI landmine that fires one day a week, on an unrelated PR.

**Proper fix (no clock dependence in the assertion):** add a helper in `tests/helpers` (for example `openSlotAfter(doctorId, minDaysAhead, hourUtc)`) that walks forward from `minDaysAhead` and returns the first instant for which `rpc("available_slots", ...)` for that doctor and clinic-local date lists the slot, or, simpler, for the doctor seeded in this spec call the existing availability helper (`tests/helpers/front-desk-commands.ts:141`, the one that updates `availability_schedule`) in the `beforeAll` to make all seven days available, so the target is open whatever the weekday. Keep the offsets (13, 11, 9) so they stay clear of the seed-slot window. Compute the weekday in the clinic zone (05:00 UTC is 10:30 IST on the same date, so UTC weekday is safe for Asia/Kolkata), and add a tiny pure test of the helper with fixed dates (every weekday of a fixed week -> never Sunday). Do it in a separate commit (it is not 09D).

---

## Low

### A-7 (Low): the dashboard layout turns every non-`AuthUnavailableError` into a redirect to `/login`

**Where:** `app/(dashboard)/layout.tsx:46-56`. `catch (error) { if (error instanceof AuthUnavailableError) throw error; }` then `redirect("/login")` for anything else. Previously only "no user" redirected. An unexpected failure (a bug in claims parsing, a Next control-flow error from `cookies()`, env misconfiguration) now silently sends a signed-in user to `/login`; the login page does not bounce a signed-in user back (checked), so it is a confusing dead end with no `request.error`. **Fix:** redirect only on `UnauthenticatedError` (or `isUnauthenticated`), rethrow the rest (and call `unstable_rethrow`).

### A-8 (Low): latent wrong-clinic context if `getActiveMembership(explicitTenantId)` is ever called without `fresh`

**Where:** `lib/auth/tenant.ts:396-420`. The RESOLVED memo records `tenantId` of the *explicit* clinic but `pin` of the active-clinic cookie; `issueContextCookie` then signs `{tid: explicit, pin: cookie}`. A later request with that pin and no explicit id gets `tid` = the explicit clinic although the pin names another one (the database path would resolve the pin's clinic). Today only `/api/session-status` passes an id and it is `fresh` (never issues), so it is unreachable. **Fix:** record RESOLVED only when `!explicitTenantId` or the explicit id equals the pin, and add a unit test.

### A-9 (Low): the access pages and the locked/onboarding redirects now read a cached level; a future in-app subscription change has no `forgetSessionContext`

**Where:** `lib/auth/access-page.ts:20-39` (header says the level "is read from the database ... fail closed"; it now comes from the cookie), `lib/auth/tenant.ts:142-150`. A platform comp or webhook that moves a clinic from `locked`/`onboarding` to `full` leaves its owner on the paywall for up to 5 minutes (the shell poll then redirects). NOTES correctly say there is no in-app subscription change today, but the upcoming Start-trial / renew actions (AUTH_REDESIGN J-A1) must call `forgetSessionContext()` and nothing enforces it. **Fix:** read `fresh: true` on the three access pages (rare, one RPC), correct the comment, and add a lint/guard-manifest note for billing actions.

### A-10 (Low): a transient time-zone read failure pins the default zone for the whole request

**Where:** `lib/datetime/server.ts:20-47`. `readTenantTimeZone` swallows the error and returns `DEFAULT_CLINIC_TZ`; `requestMemo` stores that as the answer, so every later reader in the request (queue window, schedule, billing day cut-offs) uses the default zone for a clinic in another zone. Pre-existing fallback, now amplified per request. **Fix:** do not memoise the fallback (throw inside the memoised loader and catch outside, or delete the key on failure).

### A-11 (Low): the schedule's day and week slot calls are two sequential rounds, not one

**Where:** `features/schedule/queries.ts:147-148`. `weekSlots` is only started after `daySlots` resolves, so a week view costs two sequential rounds of latency, not "one round trip of latency" as NOTES §5 says. **Fix:** build both arrays first, then `await Promise.all([Promise.all(day...), Promise.all(week...)])` (the dedupe map already shares the common (doctor, date)).

### A-12 (Low): profile and receipt fields come from JWT claims, stale for up to the token lifetime

**Where:** `features/settings/actions.ts:98-112` (`getMyProfile`: email, phone, `user_metadata`), `app/api/invoices/[id]/receipt-pdf/route.ts:89-94`, layout email (`claims.email`). After `updateUser({data:{full_name}})` the access token is not reissued, so a changed name/phone shows old values for up to 15 minutes where it falls back to metadata; the receipt PDF's doctor-name fallback can print a stale name on a legal document. (The receipt fallback also names the signed-in user as the doctor, which pre-dates 09D.) **Fix:** read `getUser()`-fresh data (or the membership row) for the receipt and profile screens, or refresh the session after `updateUser`.

### A-13 (Low): the e2e fixture hides a hang and can wrap `page.goto` twice

**Where:** `tests/e2e/fixtures.ts:67-107`. `streamedContentRevealed` swallows its own timeout (`.catch(() => undefined)`), so a boundary that never resolves (a real streaming hang) costs 5 s and then passes; and `context.on("page", settleStreamedLoads)` is registered inside `routeLoopbackOnly`, which a spec may call more than once per context, wrapping `goto`/`reload` repeatedly. The root cause is documented and credible; the guard should still surface a stuck template. **Fix:** register the listener once per context (a `WeakSet`), and attach a test annotation (or a counter) when the 5 s timeout fires so a persistent hidden `S:` template is visible in the report.

### A-14 (Low): test coverage gaps around the real request scope and the disabled path

The real `headers()` identity is exercised only by the e2e budget spec; the Vitest specs either fake the scope (`session-context-db.spec.ts`) or mock `headers` to a fresh object per call (the other specs), so they run with the memo off. There is no Vitest case for "`SESSION_CONTEXT_SECRET` unset -> no cookie issued and the database path answers" or for "`serverEnv()` throws -> no cookie, no error" (both are handled in `contextSecret`, untested). **Fix:** add those two cases to `session-context-db.spec.ts` (unstub the env) and one assertion that `requestMemo` dedupes under a shared `headers` object across two awaits.

### A-15 (Low): a context issued with an empty pin is accepted after the user gains a second clinic

**Where:** `lib/auth/tenant.ts:403-408`. A user with one clinic and no active-clinic cookie gets `clinic_ctx{pin:""}`. If an admin invites them to a second clinic and they accept on another device, this device keeps resolving the first clinic for up to the TTL where the database path would answer `MultipleClinicsSelectionRequiredError` (picker). Harmless in effect (the old clinic is still a valid membership) and the shell's first status check pins the clinic, so it is mostly theoretical. **Fix:** none required; mention in the design note.

---

## Checked and found sound (no finding)

- Memo scope: one object per request, `WeakMap` so no retention, rejected promises shared within the request only, `peekRequestMemo` swallows rejections, outside a request nothing is memoised. `forgetRequestMemo` is called after clinic switch, clinic create, invite accept, staff removal, staff/role edit and clinic settings, and removes the claims, memberships, level and zone entries.
- Cookie lifecycle: issued only after the same request read membership and level from the database (age never extends past one TTL without a DB check); bound to user, session id and pin; cleared on `/auth/signout` (all outcomes), by the proxy on every definitive sign-out, and on clinic switch. A concurrent in-flight response after a clinic switch carries the old pin and is rejected. Another user or session on the device never matches.
- Fresh path: `/api/session-status` always calls `getUser()` and re-reads membership and level (never the cookie) and its 401/403/409/503 mapping is unchanged.
- `getClaims` error classification (`isDefinitiveAuthRejection`) reaches the same `AuthUnavailableError` / `UnauthenticatedError` mapping as before; the password flows already used `getClaims` before 09D (no `getUser` regression there).
- The weakened-looking rewrites in `auth-outage-db.spec.ts` and `active-clinic-removed-db.spec.ts` assert new real outcomes (claims-path outage, fresh-path outage, the layout race now on `getClaims`); the session-context DB spec proves the RLS stop and a refused check-in for a removed member. Env schema/boot tests cover the new secret (required in production, min length, placeholder).

_Reviewed: 2026-11-23 · Reviewer: Claude (gsd-code-reviewer) · Depth: deep_
