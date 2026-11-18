# V2-06 adversarial review B: session-status, palette search, server nav and layouts, `/sw.js` public-asset

- Target: `v2/phase-06-design-system-pwa-shell` at `136cd04`. I reviewed it in a private detached worktree (since removed). The per-plan records and wave notes were not read.
- Method: code reading, then proofs. The proofs used Vitest probes against the local stack (route handler and services with real sessions and RLS) and HTTP probes against a private `npm run e2e:build` server on 127.0.0.1:3100, run under the `e2e-lane.lock`, which I took and then released.
- All data was synthetic, seeded per probe and deleted afterwards. A post-run SQL count of the probe tenants and patients returned 0. Nothing was edited on the branch.
- Counts: **High 1 · Medium 1 · Low 2 · Info 5**

---

## H-1 (High): a GoTrue outage or timeout makes `/api/session-status` answer 401, and every open app signs itself out and purges

**Where:**
- `app/api/session-status/route.ts` maps every `getActiveMembership()` failure of class `UnauthenticatedError` to 401.
- `lib/auth/tenant.ts` `getActiveMembership()` throws `UnauthenticatedError` whenever `supabase.auth.getUser()` returns *any* `error`. That includes a 5xx answer or a network failure (`AuthRetryableFetchError` / `AuthApiError` 5xx), not only a missing or revoked session.
- `lib/pwa/session-status.ts` turns 401 into `expired`. `PwaRuntime` then calls `hardSignOut("expired")`, which runs the cleanups, conceals the page, sends `POST /auth/signout`, purges storage and caches, and navigates to `/login`.

**Contradicts:**
- The route's own contract: "A lookup failure: 503 … never a sign-out".
- `lib/pwa/session-status.ts`: "A transient failure never signs anyone out".
- PWA_STRATEGY §3.7.

**Reproduction:** `tests/zz-adv-b/authblip.spec.ts` (a private probe, not committed):
1. Sign in a seeded owner with a supabase-js client whose `global.fetch` answers `/auth/v1/user` with 503, or throws `TypeError("fetch failed")`.
2. Call `GET()` with `createClient` mocked to that client.

**Observed:**
```
BLIP mode=ok:      200 {"deploymentId":null,"accessLevel":"full","redirect":null}
BLIP mode=503:     401 {"error":"unauthenticated"}
BLIP mode=network: 401 {"error":"unauthenticated"}
```

**Impact:**
- During any Supabase Auth incident, or a slow or timed-out `/auth/v1/user` call from the server region, every installed or open clinicOS client is force-signed-out on its next poll. Polls run every 5 minutes while visible, on resume, on `online`, and after any client error.
- The run is fleet-wide and across tenants.
- `hardSignOut` does not consult the dirty guard, so typed but unsaved input is lost (consult notes, registration forms). After the purge, sessionStorage and IndexedDB drafts are gone as well.
- The proxy's local JWT check (`getClaims`) can still pass during the outage. Pages would therefore keep working, but the poll ejects the user anyway.
- Rated High because it is a destructive, fleet-wide failure mode that breaks an explicit requirement. It is not a confidentiality issue.

**Fix:**
- In the route, return 401 only when the session is really absent or rejected: no session (`AuthSessionMissingError`), or GoTrue 401/403 (`session_not_found`, `bad_jwt`, user missing).
- Map every other auth error (`isAuthRetryableFetchError`, status ≥ 500, status 0 or undefined, a timeout) to 503 `unavailable`.
- Best done with a typed error in `getActiveMembership` (for example an `AuthLookupFailedError`) so the dashboard pages do not redirect to `/login` on a blip either.
- Add DB-lane tests for 503 and network failure that expect 503, and a client test that 503 never reacts.

---

## M-1 (Medium): a multi-clinic member removed from the active clinic with one clinic left is silently switched to the other clinic instead of being told "removed"

**Where:** `lib/auth/tenant.ts` `getActiveMembership()`. When exactly one active membership remains it returns that one and never compares it with the `clinic_active_tenant` cookie. With two or more remaining it does compare, and throws "not a member" (403). `/api/session-status` and the `(dashboard)` layout both inherit this behaviour.

**Reproduction:** `tests/zz-adv-b/probe.spec.ts` P1/P1b (route level) and `http.spec.ts` H5 (built server). The steps:
1. Create a user who is a receptionist in clinic A and in clinic B, with cookie `clinic_active_tenant=A`.
2. Mark A's membership `removed` (05-05).
3. Call the route and load the pages.

**Observed:**
```
P1  before removal (cookie=A):            200 {"accessLevel":"full","redirect":null}
P1  after removal from A (cookie still=A): 200 {"accessLevel":"full","redirect":null}   ← B's level, no "removed"
P1b same, but still in B and C:            403 {"error":"no_membership"}                ← hardSignOut("removed")
H5  after removal: /api/session-status 200; /patients/<A patient> 404;
    /patients 200 listing B's patient, shell shows B's clinic name
```

**Impact:**
1. The removed member's open screen keeps clinic A's patient data with no conceal and no purge. R-16 / PWA §6.6 say removal means sign-out and purge. The same removal *does* sign out a member who has two other clinics, so the behaviour depends on how many clinics remain.
2. On the next client navigation the server resolves clinic B, but the already-rendered shell, including the clinic name, still says A until a full reload. Data the user believes they are entering for A goes into B (wrong-clinic writes), and A's device state (drafts, IndexedDB) stays on the device.
- No data of A is newly disclosed after removal, because RLS holds. The problems are the stale PHI on screen and the integrity risk.

**Fix:**
- In `getActiveMembership` (or at least in `/api/session-status` and the `(dashboard)` layout): when a `clinic_active_tenant` cookie is present and names a clinic that is not among the active memberships, treat that as removal whatever the remaining count. In the route that means 403 `no_membership`, or a distinct code that triggers conceal, purge and a hard reload to a clinic picker.
- Alternatively, write the cookie whenever the single-membership fallback is used, and have the poll compare the active clinic. For that, the route can return an opaque per-session hash of the tenant id; it needs no raw id.
- Add a DB test for "dual member removed from the active clinic, one left".

---

## L-1 (Low): the palette patient search accepts LIKE and PostgREST wildcards, so a 2-character query of `%%`, `__` or `**` lists the clinic's newest patients

**Where:** `features/patients/service.ts` `buildPatientSearchFilter` (shared with v1 `searchPatients`). It strips `, ( )` but not `%`, `_` or `*`, and `PALETTE_MIN_QUERY = 2` counts them as characters.

**Observed (receptionist, own clinic):**
- `"%%"`, `"__"`, `"**"` and `"%_"` each returned all 3 seeded patients (cap 8).
- `"90000000__"` returned every patient whose number starts with those digits.
- The other clinic's patient never appeared (`"Bee"` returned 0). A forged ctx with `tenantId=B` also returned 0, because RLS holds.

**Impact:** low. The same roles (`patients:view`) can list the whole directory at `/patients`. However, the minimum query length is meaningless, and `_` gives a precise per-digit phone oracle that defeats the "last 4 only" projection (see I-2).

**Fix:**
- Escape `\`, `%` and `_` with `\` before building the ilike pattern, and map `*` to a literal, or strip it.
- Count only letters and digits toward `PALETTE_MIN_QUERY`.
- Add tests for `%%`, `__` and `**` that expect `[]`.

## L-2 (Low): no server-side rate limit on `/api/session-status` or the palette search actions

**Where and impact:**
- `checkSessionNow()` ("Check for updates") is deliberately not throttled.
- The palette relies on a 200 ms client debounce. Any signed-in member can call `searchPatientsForPalette` or `searchTodayQueueForPalette` directly, as server actions, at any rate.
- Each call costs `auth.getUser` plus the membership lookup plus an RPC or query. Combined with L-1 or I-2 this allows scripted enumeration at speed. Exposure is limited to the caller's own clinic and to what the role can already see.

**Fix:** per-user token bucket on both palette actions (for example 10/s) and on the route (for example 1 per 2 s, answering 429). The client already treats 429 as "unknown", so no sign-out follows.

---

## Info

- **I-1 deploymentId exposure.** The value equals Next's `deploymentId`, which every page already ships (`data-dpl-id`, `NEXT_DEPLOYMENT_ID`, and `?dpl=` on asset URLs), and `/api/health` already exposes `release` anonymously. It is only returned to an authenticated member, and the body has exactly three keys with no ids, names or emails (`H1`). Acceptable.
- **I-2 phone-digit oracle.** Both palette searches match on the full phone: the queue search on any run of 4 or more digits, the patient search through ilike including `_`. A member can therefore confirm or reconstruct a full mobile number although the row shows only the last 4. The same roles see the full number on the patient record (`patient-identity-header` `full` variant), so this is no escalation today. If phone visibility is ever narrowed per role, the search must narrow with it.
- **I-3 doctor queue scope.** For a doctor the palette's "Today queue" covers the whole clinic's queue, not only "My queue". This matches the `/queue` page, which a doctor can open, and the permission matrix (`appointments:view`). It is noted in case IA §3.6 "My queue" is meant to be the boundary.
- **I-4 suspended or removed treated alike.** A `suspended` membership (status ≠ `active`) gets 403, then `hardSignOut("removed")`. This is consistent with 05-05, and noted for the copy.
- **I-5 `/SW.JS`.** It answers 307 to `/login` but still carries `content-type: application/javascript`, a header artefact of the `next.config.ts` header rule matching case-insensitively. It is harmless.

---

## Attacks that held

**`/api/session-status`**
- Anonymous: 401, `private, no-store`.
- Forged `?tenant=<B>`: ignored (200, own clinic).
- A single-clinic owner with cookie `clinic_active_tenant=<B>`: ignored (own clinic answered, nothing of B).
- Dual member with a cookie naming a clinic they never belonged to: 403.
- Cross-origin `Origin: https://evil.example`: no `Access-Control-Allow-Origin` on GET, HEAD or OPTIONS; POST answers 405. GET is side-effect-free, so CSRF is moot, and a cross-origin read of the JSON is blocked by the same-origin policy. `Vary` includes the RSC headers.
- Bodies have exactly `deploymentId`, `accessLevel` and `redirect`: no UUID, clinic name or email.
- The client `parseSessionStatus` refuses extra keys, an unknown level, a destination outside the three, and a full/redirect mismatch. Only one of the three fixed paths is ever followed, so there is no open redirect.
- No reload loop: the locked and onboarding destinations sit outside `(dashboard)`, so `PwaRuntime` and its poll do not run there. `onLocked` is single-shot (`leaving`), `expired`, `removed` and `locked` stop the watch, and a page without a deployment id never reports an update.
- A locked user's screen is concealed and made inert before cleanups and `location.replace` (D-8 keeps the session by design).
- 409, 5xx, offline and timeout answers never react. The exception is the auth-lookup failure in H-1.

**Palette searches**
- Tenant comes from the session (`resolveServiceContext`). A forged ctx tenant is still stopped by RLS.
- Projection is exactly `id/name/ageSex/phoneLast4` and `visitId/token/name/status`.
- PostgREST filter injection fails: `%,tenant_id.neq.x`, `a%.ilike.*`, `"x"` and `%\` return 0 or error to `[]`.
- Per role (nurse, receptionist, admin, doctor), the queue search gives only the four keys. The client offers patient search only when `/patients` is in the role's nav, and nothing is persisted (no recents, no storage).

**Server nav and segment layouts (journey-09)**
- Owner of A requesting B's `/patients/<id>` and `/consultation/<id>`:
  - Document request: **404**, B's name and phone absent.
  - RSC, prefetch and segment-prefetch (`RSC: 1`, `Next-Router-Prefetch`, `Next-Router-Segment-Prefetch`): 200 not-found payloads with nothing of B.
- Role redirects now answer 307 on a document load above `loading.tsx`:
  - doctor `/` → `/cabin`
  - nurse or receptionist `/cabin` → `/queue`
  - doctor or nurse `/billing/reports` → `/`
  - RSC variants carry the redirect in the payload with no page data.
- `navForRole` runs server-side from the session role. It is only an offer: the pages keep their guards (receptionist `/settings/developer` gets "Access Denied", nothing loaded).

**`/sw.js` public-asset**
- Anonymous and signed-in bodies are byte-identical, with no `Set-Cookie`, no ids and no B values.
- `/sw.js/x` → 404.
- `/sw.js/..%2Fpatients`, `/sw.js%2F..%2Fpatients`, `/sw.jsx` and `/sw.js/..%2Fpatients%2F<id>` → 307 `/login` (protected: the public-prefix check normalises both raw and decoded paths).
- `/sw.js/` → 308 `/sw.js`.
- The worker never stores navigations, RSC, `/api` or `private`/`no-store` answers, and precaches only signed-out, non-redirected assets.
- The `public-asset` guard leg asserts anonymous == member, no access, no cookie and the content type, so a route misfiled as `public-asset` that personalises its answer would fail it.
