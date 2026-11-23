# 09D — Request speed: Supabase round trips per click

Branch `v2/phase-09d-request-speed` (from `0acb544c` = `feature/v2` + docs). PO-approved approach (2026-11-23).
No migration, no new dependency.

## Problem (measured)

Every page navigation re-fetched the same identity and clinic facts: `auth.getUser()` (a GoTrue round trip) in the
layout, in `getActiveMembership()` and in several other modules, the `memberships` read and the `my_tenant_access` RPC in
every guard, and `tenants` for the shell, with no per-request dedupe. About 20 of every ~30 Supabase calls per page were
these. Staging (Vercel bom1 → Supabase Sydney) pays ~300–450 ms per call, so the count is what a click costs.

## Measurement (tool output)

`npm run perf:roundtrips` (Playwright project `perf-roundtrips`, `tests/e2e/perf/page-roundtrips.spec.ts`, outside the
PR lane): on the local e2e production build, as the receptionist and the doctor, for /today, /schedule (day, week),
/patients, a patient, /consultation/[id] (doctor), /billing/register, /settings/clinic:

- **full load** (`page.goto`, includes the shell's on-load `/api/session-status` check) and **in-app** navigation
  (`router.push`, what a link click does), median of 3 after one warm-up;
- Supabase calls counted from the local Kong access log between two marker requests (`tests/e2e/support/kong-calls.ts`),
  split app-server vs browser, by path (no ids, no query strings);
- one server action: the receptionist's Check in on Today (click → row in Waiting).

Times are local (Kong/PostgREST on the same machine, ~1–5 ms per call); the call count is the staging-relevant number.
"responseEnd" = document fully streamed (full load); in-app = push → last RSC byte.

### Before (base sources of `0acb544c`) vs after (final tree `26fab3d2`), app-server Supabase calls

Before = `perf:roundtrips` on a build of the base app sources (checked out over this branch, rebuilt, measured, restored;
`git diff --exit-code HEAD` clean). After = the same script on the final tree after `npm run stack:recycle`. The PO's
staging-reported counts (/today 27, /schedule 31, week 38, /patients 27) match the "before" full-load rows. "user /
memberships / my_tenant_access" are the identity/context paths; after the change, the one `/auth/v1/user` + one
`my_tenant_access` on a full load is the shell's on-load `/api/session-status` fresh check, and the remaining
`memberships` reads are the shell's clinic list (full load only), the status check, and page data (doctor/staff
directories).

| Role | Navigation | Page | Before: Supabase calls | After | Before: user / memberships / my_tenant_access | After | Before ms | After ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| receptionist | full load | /today | 26 | **10** | 8 / 6 / 6 | 1 / 3 / 1 | 72 | 20 |
| receptionist | full load | /schedule (day) | 30 | **14** | 8 / 6 / 6 | 1 / 3 / 1 | 88 | 34 |
| receptionist | full load | /schedule?view=week | 38 | **21** | 8 / 6 / 6 | 1 / 3 / 1 | 91 | 53 |
| receptionist | full load | /patients | 27 | **8** | 10 / 6 / 6 | 1 / 2 / 1 | 66 | 15 |
| receptionist | full load | /patients/[id] | 43 | **17** | 14 / 6 / 10 | 1 / 3 / 1 | 87 | 18 |
| receptionist | full load | /billing/register → /billing/reports | 37 | **10** | 14 / 7 / 9 | 1 / 3 / 1 | 153 | 28 |
| receptionist | full load | /settings/clinic | 28 | **9** | 9 / 7 / 7 | 1 / 3 / 1 | 68 | 14 |
| receptionist | in-app | /today | 9 | **4** | 2 / 2 / 2 | 0 / 1 / 0 | 77 | 27 |
| receptionist | in-app | /schedule (day) | 13 | **8** | 2 / 2 / 2 | 0 / 1 / 0 | 87 | 39 |
| receptionist | in-app | /schedule?view=week | 21 | **15** | 2 / 2 / 2 | 0 / 1 / 0 | 100 | 42 |
| receptionist | in-app | /patients | 10 | **2** | 4 / 2 / 2 | 0 / 0 / 0 | 59 | 12 |
| receptionist | in-app | /patients/[id] | 26 | **11** | 8 / 2 / 6 | 0 / 1 / 0 | 94 | 27 |
| receptionist | in-app | /settings/clinic | 11 | **3** | 3 / 3 / 3 | 0 / 1 / 0 | 67 | 24 |
| doctor | full load | /today | 35 | **13** | 11 / 7 / 8 | 1 / 3 / 1 | 75 | 25 |
| doctor | full load | /schedule (day) | 29 | **13** | 8 / 6 / 6 | 1 / 3 / 1 | 76 | 32 |
| doctor | full load | /schedule?view=week | 37 | **20** | 8 / 6 / 6 | 1 / 3 / 1 | 82 | 41 |
| doctor | full load | /patients | 27 | **8** | 10 / 6 / 6 | 1 / 2 / 1 | 68 | 13 |
| doctor | full load | /patients/[id] | 48 | **18** | 16 / 7 / 11 | 1 / 3 / 1 | 84 | 25 |
| doctor | full load | /consultation/[id] | 59 | **23** | 19 / 5 / 15 | 1 / 2 / 1 | 308 | 78 |
| doctor | full load | /billing/register → /today | 55 | **15** | 21 / 11 / 12 | 1 / 5 / 1 | 193 | 43 |
| doctor | full load | /settings/clinic | 28 | **9** | 9 / 7 / 7 | 1 / 3 / 1 | 66 | 18 |
| doctor | in-app | /today | 18 | **7** | 5 / 3 / 4 | 0 / 1 / 0 | 106 | 32 |
| doctor | in-app | /schedule (day) | 12 | **7** | 2 / 2 / 2 | 0 / 1 / 0 | 78 | 35 |
| doctor | in-app | /schedule?view=week | 20 | **14** | 2 / 2 / 2 | 0 / 1 / 0 | 96 | 42 |
| doctor | in-app | /patients | 10 | **2** | 4 / 2 / 2 | 0 / 0 / 0 | 70 | 19 |
| doctor | in-app | /patients/[id] | 26 | **11** | 8 / 2 / 6 | 0 / 1 / 0 | 100 | 29 |
| doctor | in-app | /consultation/[id] | 38 | **16** | 11 / 1 / 10 | 0 / 0 / 0 | 237 | 53 |
| doctor | in-app | /settings/clinic | 11 | **3** | 3 / 3 / 3 | 0 / 1 / 0 | 57 | 24 |

| Role | Server action | Before: Supabase calls | After | Before by path | After by path | Before ms | After ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| receptionist | Check in (Today) | 34 | **11** | GET /auth/v1/user ×11; GET /rest/v1/memberships ×7; POST /rest/v1/rpc/my_tenant_access ×7; GET /rest/v1/tenants ×6; GET /rest/v1/visits ×2; POST /rest/v1/rpc/check_in_visit ×1 | GET /rest/v1/tenants ×4; GET /rest/v1/memberships ×4; GET /rest/v1/visits ×2; POST /rest/v1/rpc/check_in_visit ×1 | 41 | 32 |

After, server calls by path (last sample) per page:

| Role | Navigation | Page | After: calls by path |
| --- | --- | --- | --- |
| receptionist | full load | /today | GET /rest/v1/memberships ×3; GET /rest/v1/tenants ×2; GET /rest/v1/visits ×1; HEAD /rest/v1/in_app_notifications ×1; GET /rest/v1/in_app_notifications ×1; GET /auth/v1/user ×1; POST /rest/v1/rpc/my_tenant_access ×1 |
| receptionist | full load | /schedule (day) | GET /rest/v1/memberships ×3; GET /rest/v1/tenants ×2; POST /rest/v1/rpc/available_slots ×2; GET /rest/v1/visits ×1; GET /rest/v1/schedule_blocks ×1; GET /rest/v1/waitlist_entries ×1; HEAD /rest/v1/in_app_notifications ×1; GET /rest/v1/in_app_notifications ×1; GET /auth/v1/user ×1; POST /rest/v1/rpc/my_tenant_access ×1 |
| receptionist | full load | /schedule?view=week | POST /rest/v1/rpc/available_slots ×8; GET /rest/v1/memberships ×3; GET /rest/v1/tenants ×2; GET /rest/v1/visits ×2; GET /rest/v1/schedule_blocks ×1; GET /rest/v1/waitlist_entries ×1; HEAD /rest/v1/in_app_notifications ×1; GET /rest/v1/in_app_notifications ×1; GET /auth/v1/user ×1; POST /rest/v1/rpc/my_tenant_access ×1 |
| receptionist | full load | /patients | GET /rest/v1/memberships ×2; GET /rest/v1/patients ×2; HEAD /rest/v1/in_app_notifications ×1; GET /rest/v1/in_app_notifications ×1; GET /auth/v1/user ×1; POST /rest/v1/rpc/my_tenant_access ×1 |
| receptionist | full load | /patients/[id] | GET /rest/v1/memberships ×3; GET /rest/v1/patients ×2; GET /rest/v1/consent_records ×2; GET /rest/v1/visits ×1; POST /rest/v1/rpc/log_audit ×1; GET /rest/v1/prescriptions ×1; GET /rest/v1/queue_tokens ×1; GET /rest/v1/consultation_diagnoses ×1; GET /rest/v1/invoices ×1; HEAD /rest/v1/in_app_notifications ×1; GET /rest/v1/in_app_notifications ×1; GET /auth/v1/user ×1; POST /rest/v1/rpc/my_tenant_access ×1 |
| receptionist | full load | /billing/register | GET /rest/v1/memberships ×3; GET /rest/v1/tenants ×1; GET /rest/v1/payments ×1; GET /rest/v1/invoices ×1; HEAD /rest/v1/in_app_notifications ×1; GET /auth/v1/user ×1; GET /rest/v1/in_app_notifications ×1; POST /rest/v1/rpc/my_tenant_access ×1 |
| receptionist | full load | /settings/clinic | GET /rest/v1/memberships ×3; GET /rest/v1/tenants ×1; HEAD /rest/v1/in_app_notifications ×1; GET /rest/v1/in_app_notifications ×1; GET /auth/v1/user ×1; POST /rest/v1/rpc/my_tenant_access ×1; GET /rest/v1/schedule_blocks ×1 |
| receptionist | in-app | /today | GET /rest/v1/tenants ×2; GET /rest/v1/visits ×1; GET /rest/v1/memberships ×1 |
| receptionist | in-app | /schedule (day) | GET /rest/v1/tenants ×2; POST /rest/v1/rpc/available_slots ×2; GET /rest/v1/memberships ×1; GET /rest/v1/visits ×1; GET /rest/v1/schedule_blocks ×1; GET /rest/v1/waitlist_entries ×1 |
| receptionist | in-app | /schedule?view=week | POST /rest/v1/rpc/available_slots ×8; GET /rest/v1/tenants ×2; GET /rest/v1/visits ×2; GET /rest/v1/memberships ×1; GET /rest/v1/schedule_blocks ×1; GET /rest/v1/waitlist_entries ×1 |
| receptionist | in-app | /patients | GET /rest/v1/patients ×2 |
| receptionist | in-app | /patients/[id] | GET /rest/v1/consent_records ×2; GET /rest/v1/patients ×2; GET /rest/v1/visits ×1; POST /rest/v1/rpc/log_audit ×1; GET /rest/v1/queue_tokens ×1; GET /rest/v1/prescriptions ×1; GET /rest/v1/consultation_diagnoses ×1; GET /rest/v1/invoices ×1; GET /rest/v1/memberships ×1 |
| receptionist | in-app | /settings/clinic | GET /rest/v1/tenants ×1; GET /rest/v1/memberships ×1; GET /rest/v1/schedule_blocks ×1 |
| doctor | full load | /today | GET /rest/v1/memberships ×3; GET /rest/v1/visits ×3; GET /rest/v1/tenants ×2; POST /rest/v1/rpc/my_entitlements ×1; HEAD /rest/v1/in_app_notifications ×1; GET /rest/v1/in_app_notifications ×1; GET /auth/v1/user ×1; POST /rest/v1/rpc/my_tenant_access ×1 |
| doctor | full load | /schedule (day) | GET /rest/v1/memberships ×3; GET /rest/v1/tenants ×2; GET /rest/v1/visits ×1; GET /rest/v1/schedule_blocks ×1; POST /rest/v1/rpc/available_slots ×1; GET /rest/v1/waitlist_entries ×1; HEAD /rest/v1/in_app_notifications ×1; GET /rest/v1/in_app_notifications ×1; GET /auth/v1/user ×1; POST /rest/v1/rpc/my_tenant_access ×1 |
| doctor | full load | /schedule?view=week | POST /rest/v1/rpc/available_slots ×7; GET /rest/v1/memberships ×3; GET /rest/v1/tenants ×2; GET /rest/v1/visits ×2; GET /rest/v1/schedule_blocks ×1; GET /rest/v1/waitlist_entries ×1; HEAD /rest/v1/in_app_notifications ×1; GET /rest/v1/in_app_notifications ×1; GET /auth/v1/user ×1; POST /rest/v1/rpc/my_tenant_access ×1 |
| doctor | full load | /patients | GET /rest/v1/memberships ×2; GET /rest/v1/patients ×2; HEAD /rest/v1/in_app_notifications ×1; GET /rest/v1/in_app_notifications ×1; GET /auth/v1/user ×1; POST /rest/v1/rpc/my_tenant_access ×1 |
| doctor | full load | /patients/[id] | GET /rest/v1/memberships ×3; GET /rest/v1/patients ×2; GET /rest/v1/consent_records ×2; GET /rest/v1/visits ×2; GET /rest/v1/queue_tokens ×1; GET /rest/v1/prescriptions ×1; POST /rest/v1/rpc/log_audit ×1; GET /rest/v1/consultation_diagnoses ×1; GET /rest/v1/invoices ×1; HEAD /rest/v1/in_app_notifications ×1; GET /rest/v1/in_app_notifications ×1; GET /auth/v1/user ×1; POST /rest/v1/rpc/my_tenant_access ×1 |
| doctor | full load | /consultation/[id] | GET /rest/v1/visits ×4; GET /rest/v1/prescriptions ×3; GET /rest/v1/memberships ×2; GET /rest/v1/consultation_diagnoses ×2; GET /rest/v1/queue_tokens ×1; GET /rest/v1/follow_ups ×1; POST /rest/v1/rpc/my_entitlements ×1; POST /rest/v1/rpc/consult_assist_context ×1; POST /rest/v1/rpc/patient_snapshot ×1; GET /rest/v1/doctor_text_macros ×1; HEAD /rest/v1/in_app_notifications ×1; GET /rest/v1/patient_documents ×1; POST /rest/v1/rpc/rx_allergy_context ×1; GET /rest/v1/in_app_notifications ×1; GET /auth/v1/user ×1; POST /rest/v1/rpc/my_tenant_access ×1 |
| doctor | full load | /billing/register | GET /rest/v1/memberships ×5; GET /rest/v1/visits ×3; GET /rest/v1/tenants ×2; POST /rest/v1/rpc/my_entitlements ×1; HEAD /rest/v1/in_app_notifications ×1; GET /rest/v1/in_app_notifications ×1; GET /auth/v1/user ×1; POST /rest/v1/rpc/my_tenant_access ×1 |
| doctor | full load | /settings/clinic | GET /rest/v1/memberships ×3; GET /rest/v1/tenants ×1; HEAD /rest/v1/in_app_notifications ×1; GET /rest/v1/in_app_notifications ×1; GET /auth/v1/user ×1; POST /rest/v1/rpc/my_tenant_access ×1; GET /rest/v1/schedule_blocks ×1 |
| doctor | in-app | /today | GET /rest/v1/visits ×3; GET /rest/v1/tenants ×2; GET /rest/v1/memberships ×1; POST /rest/v1/rpc/my_entitlements ×1 |
| doctor | in-app | /schedule (day) | GET /rest/v1/tenants ×2; GET /rest/v1/memberships ×1; GET /rest/v1/visits ×1; GET /rest/v1/schedule_blocks ×1; POST /rest/v1/rpc/available_slots ×1; GET /rest/v1/waitlist_entries ×1 |
| doctor | in-app | /schedule?view=week | POST /rest/v1/rpc/available_slots ×7; GET /rest/v1/tenants ×2; GET /rest/v1/visits ×2; GET /rest/v1/memberships ×1; GET /rest/v1/schedule_blocks ×1; GET /rest/v1/waitlist_entries ×1 |
| doctor | in-app | /patients | GET /rest/v1/patients ×2 |
| doctor | in-app | /patients/[id] | GET /rest/v1/consent_records ×2; GET /rest/v1/patients ×2; GET /rest/v1/visits ×1; POST /rest/v1/rpc/log_audit ×1; GET /rest/v1/queue_tokens ×1; GET /rest/v1/consultation_diagnoses ×1; GET /rest/v1/prescriptions ×1; GET /rest/v1/memberships ×1; GET /rest/v1/invoices ×1 |
| doctor | in-app | /consultation/[id] | GET /rest/v1/visits ×3; GET /rest/v1/prescriptions ×3; GET /rest/v1/consultation_diagnoses ×2; GET /rest/v1/queue_tokens ×1; GET /rest/v1/follow_ups ×1; POST /rest/v1/rpc/my_entitlements ×1; POST /rest/v1/rpc/consult_assist_context ×1; POST /rest/v1/rpc/patient_snapshot ×1; GET /rest/v1/doctor_text_macros ×1; GET /rest/v1/patient_documents ×1; POST /rest/v1/rpc/rx_allergy_context ×1 |
| doctor | in-app | /settings/clinic | GET /rest/v1/tenants ×1; GET /rest/v1/memberships ×1; GET /rest/v1/schedule_blocks ×1 |

Raw reports (tool output): `test-results/perf-roundtrips/summary.{md,json}` of each run; copies kept with the phase
scratch logs. Remaining page-data duplicates, for 09E: Today/Schedule read `tenants` twice (zone + the doctor directory's
`owner_is_practicing_doctor`); the week view still needs one `available_slots` per day; the Patients list's links
prefetch `/patients/[id]` (one `patients` read per row in view); Check in renders twice (the action's revalidation and
the board's live refresh).


## Design as built

### 1. Per-request dedupe (`lib/auth/request-memo.ts`)

One resolver chain, every caller uses it (no parallel resolver left):
`getSessionClaims()` → `getActiveMembership()` → `getTenantAccessLevel()`, used by `requireServiceContext` /
`resolveServiceContext`, `requirePermission`, `withPageAuth`, `requireAccessDestination`, the dashboard layout, the
clinic switcher (`listUserClinics`, `resolveClinicSwitch`, `hasActiveMembership`), the subscription overview and the
other former `getUser()` callers. Memoised once per request: the claims (keyed by a hash of the auth cookies), the
membership rows (`memberships` + `tenants(name, timezone)` in one query, shared by the membership resolution, the
switcher and the shell's clinic name/zone), the access level per clinic, and `getTenantTimeZone` per clinic.

React `cache()` alone was not enough: it memoises only inside a React server render (verified in
`react-server-dom-webpack`: outside a Flight request `getCacheForType` returns a fresh map), so Server Actions and route
handlers would still repeat every lookup. The memo is keyed on Next's request header store (`await headers()` resolves to
the same object for every call within one request, a new one per request); outside a request nothing is memoised.
`forgetSessionContext()` drops the request's memo after an action that changed the context.

### 2. Signed session-context cookie (`lib/auth/context-cookie.ts`)

- Name `clinic_ctx`; HttpOnly; SameSite=Lax; Path=/; Secure on https and in production off loopback (the active-clinic
  pin's rule, now `lib/auth/cookie-secure.ts`); Max-Age 300 s.
- Contents (ids, role and state only; no PHI, names or emails): `v` (1), `uid`, `sid` (the JWT `session_id`), `tid`
  (active clinic), `role`, `lvl` (access level `full|locked|onboarding|none`), `pin` (the `clinic_active_tenant` value it
  was resolved under, "" for none), `iat`, `exp`. Permission set: derived from the role by the current code at use time
  (`lib/permissions`), so a deploy that changes the matrix applies at once (no permission version needed).
- Wire form `base64url(JSON).base64url(HMAC-SHA256(SESSION_CONTEXT_SECRET, "clinicos.session-context.v1." + payload))`.
- Accepted only when: MAC verifies (constant time); shape/role/level known; `iat` not in the future (30 s skew),
  `exp − iat ≤ 300`, `exp > now`; `uid` = verified JWT `sub`; `sid` = JWT `session_id` (a token without one never
  matches); `pin` = this request's active-clinic cookie. Otherwise ignored: the database answers and the cookie may be
  reissued.
- TTL 5 min (< the 900 s access token). Issued only after this request read BOTH the membership and the access level from
  the database (so its age never extends past one TTL without a database check), by a Server Action or route handler (a
  Server Component cannot set cookies), and by `/api/session-status` (the shell polls it on load, resume, `online` and every
  5 min while visible) with the pin that response leaves in place.
- Expired / refused on: sign-out (the `/auth/signout` route, every scope and outcome; the proxy on every definitively
  signed-out request, including the emailed-code session end), clinic switch (expired and also refused for the new pin),
  clinic creation, invitation accepted, staff removal, staff/role edit, clinic settings edit (`forgetSessionContext`).
  Another user or another session on the device never matches (`uid`/`sid`). There is no in-app subscription state change
  today (trial/renewal state changes come from the billing webhooks); a change made elsewhere is picked up within 5 min
  by the app and at once by the database.
- Secret: new env var `SESSION_CONTEXT_SECRET` (no existing server secret is a suitable HMAC key: the others are webhook,
  cron, ingest or provider keys with their own rotation). ≥ 32 chars; required in production; unset (dev, Vitest, staging
  until set) = no cookie, context from the database once per request. Test lanes: unset or the synthetic
  `LOCAL_SESSION_CONTEXT_SECRET`; the e2e server runs with it.

### 3. Identity without network

`getSessionClaims()` reads the session with `supabase.auth.getClaims()` once per request.

- **This stack:** the local Auth signs with ES256 (`/auth/v1/.well-known/jwks.json` lists an EC P-256 key with a `kid`),
  so auth-js 2.117.2 verifies the token locally with WebCrypto against the JWKS, which it caches process-wide for
  10 minutes (`GLOBAL_JWKS`, `JWKS_TTL`). Measured: zero `/auth/v1/user` calls on every in-app navigation; the only one on a
  full load is the shell's fresh status check.
- **Hosted projects:** auth-js falls back to `getUser()` (one Auth round trip) when the token's `alg` is `HS*` or it has
  no `kid`, i.e. when the project still signs with the legacy JWT secret. The `sb_publishable_`/`sb_secret_` API keys do
  not decide this; the project's JWT signing keys do (Dashboard → Project Settings → JWT Keys). Not checked against staging
  from here (no hosted access from this lane) — PO action below. Even on HS256 the memo makes it one call per request
  (plus the proxy's own), not 8–19.
- `getUser()` remains only where a fresh answer from Supabase Auth is required: `/api/session-status` (the shell's fresh
  check; it detects a session revoked elsewhere and answers 401 → `hardSignOut`), via `getActiveMembership(…, { fresh:
  true })`. The password and account-security flows did not use `getUser()` for identity (they use `getClaims()` for
  `amr`, and `updateUser` itself goes to GoTrue).
- Behaviour change (documented, tests updated): a session revoked elsewhere whose access token is still unexpired is no
  longer refused by page loaders; the on-load/5-min status check (fresh `getUser`) ends it on the device, and the proxy
  refuses it once the token expires and the refresh fails. Data protection never depended on this check: an access token
  cannot be revoked before it expires at PostgREST either (AUTH_REDESIGN principle 5); membership is enforced by RLS.

### 4. Security stays in the database

RLS and the definer commands keep checking membership, role and access on every read and write; the cookie only saves the
app-side lookups. A removed member keeps app navigation for at most 5 minutes (or until the next status poll, whichever
is first); their reads return nothing and their commands are refused at once (proof below). No service-role client was
added; R-42 (the `x-clinicos-tenant` header from the active-clinic cookie) is unchanged; the removal semantics
(`ActiveClinicMembershipEndedError` → sign-out) are unchanged on every database read, and the status poll is fresh.

### 5. Schedule week view

`available_slots(p_doctor_id, p_date, …)` takes one doctor and one date; there is no range form, and adding one needs a
migration (not unavoidable, so not done). The day grid and the week strip now send their calls together (one round trip of
latency instead of up to 9 in a row) and ask a (doctor, date) pair once (receptionist week view 9 → 8 calls).

### Other

- Dashboard layout: one membership read gives the switcher, the clinic name and the zone (the separate `tenants` read is
  gone); identity from the claims; the email shown in the user menu comes from the claims.
- Today e2e helpers wait for the visible board only (React briefly holds the revealed board and its hidden `S:n` template
  while a streamed page is revealed; the faster server made that window reachable).


## Proofs

### Fails-without (revert one behaviour, run, expect red, restore, `cmp`)

Driver: a scratch script applied one mutation, ran the named Vitest specs, restored the file from a copy and ran `cmp`
(0 = identical); afterwards `git diff --exit-code HEAD -- app features lib proxy.ts` was clean. Tool output:

| Mutation (behaviour removed) | Red tests | Restored (`cmp`) |
| --- | --- | --- |
| `verifyContext` skips the MAC check (signature) | `context-cookie.spec` › signature | 0 |
| `verifyContext` skips the expiry/lifetime check | `context-cookie.spec` › expiry | 0 |
| `verifyContext` skips the session-id binding | `context-cookie.spec` › session binding; `session-context-db.spec` › another session of the same user | 0 |
| `switchClinic` no longer calls `forgetSessionContext` (clinic-switch reissue/clear) | `session-context-db.spec` › clinic switcher expires the cookie | 0 |
| `/auth/signout` no longer expires `clinic_ctx` | `signout-route.spec` › every sign-out expires the session-context cookie | 0 |
| the proxy no longer expires `clinic_ctx` on a definitive sign-out | `session-auth-close-db.spec` › definitive sign-out also expires the session-context cookie | 0 |
| `requestMemo` never memoises (per-request dedupe) | `session-context-db.spec` › one request: one membership read, one access-level read, no Auth call | 0 |
| `getActiveMembership` ignores a valid cookie | `session-context-db.spec` › next request with the cookie: no membership/access/Auth call; removed member (cookie path) | 0 |

Call-count ceiling: `tests/e2e/shell/request-budget.spec.ts` (PR lane, desktop-chrome) run against a build of the base
sources (the app files of `0acb544c` checked out over this branch, rebuilt, then restored with `git checkout HEAD --` and
`git diff --exit-code` clean): both tests red —
in-app Patients `{"GET /auth/v1/user":4,"GET /rest/v1/memberships":2,"POST /rest/v1/rpc/my_tenant_access":2,"GET /rest/v1/patients":2}`
(expected 0 Auth calls, got 4); full-load Today `GET /auth/v1/user` ×8 (expected ≤ 1). Green on this branch. It runs
reliably in the PR lane because it budgets only the identity/context calls, which do not depend on the clinic's data:
in-app Patients and Today 0 `/auth/v1/user` and 0 `my_tenant_access` (Patients 0 `memberships`, Today ≤ 1, the doctor
directory); Today full load ≤ 1 / ≤ 1 / ≤ 3. A first version also capped total calls (Patients ≤ 3, Today ≤ 6 / 12) and
failed in the full PR run for data reasons (tenant A by then has many patients, whose row links prefetch
`/patients/[id]`; Today's billing lanes add invoice/payment/follow-up reads), so totals stay in the report script.

### Removed member: refused at once by the database

`tests/auth/session-context-db.spec.ts` › "removed member": a receptionist gets a cookie, can read a patient; the
membership is set `removed`; the next request with the still-valid cookie resolves the app-side context without any
database read (navigation ≤ TTL), but `patients` and `visits` reads return `[]` (RLS), the real `checkInVisit` Server
Action (which passes the app-side guard on the stale cookie) is refused and the visit stays `booked`, and the fresh
`/api/session-status` answers 403 (the device signs out). Control: the owner's check-in of the same visit succeeds. The
existing RLS/command suites (pgTAP, `tests/auth/active-clinic-removed-db.spec.ts`, guard suites) still pass.

### New and changed tests

- `tests/auth/context-cookie.spec.ts` (8): round trip and fields; pin case/absence; signature (changed payload, changed MAC,
  other key, empty MAC); malformed; expiry (at/after exp, future iat, lifetime over TTL even when correctly signed); session
  binding (other user, other session, no session id); pin binding; TTL/attributes; proxy constant = cookie name.
- `tests/auth/session-context-db.spec.ts` (8, local stack): per-request counts; issue (fields, attributes, no email);
  reuse with zero context calls; refused forged/other-user/other-pin; other session of the same user; status poll fresh +
  reissue with the pin; removed member; clinic switch.
- `tests/auth/signout-route.spec.ts` (+1), `tests/auth/session-auth-close-db.spec.ts` (+1): clearing on every sign-out path.
- `tests/config/env-schema.spec.ts` (+6), `tests/config/env-boot.spec.ts` (profile + assertion): the new key's rules.
- `tests/e2e/shell/request-budget.spec.ts` (2, PR lane, desktop-chrome): the identity/context call ceiling.
- Rewritten to the new contract: `tests/auth/page-revoked-session.spec.ts`, `tests/auth/auth-outage-db.spec.ts` (3 cases),
  `tests/auth/active-clinic-removed-db.spec.ts` (race case), `tests/security/review-fixes-app.spec.ts` (mock has `getClaims`),
  `tests/clinics/switch-clinic-db.spec.ts` unchanged (the layout passes the picker `id, name, role` only, as before).


## Verification on the final tree

All on the final tree after `npm run stack:recycle` (tool output in the phase scratch logs):

| Check | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npx eslint .` | exit 0 (0 errors; 390 warnings, all pre-existing: 0 in the files this phase changed) |
| `npm run inventory` | exit 0 |
| `npm run ci:ui-policy` / `npm run ci:ai-l1` | PASS / PASS |
| `node scripts/ci/env-example.mjs --check` | `.env.example` matches `lib/env.ts` |
| `npm run e2e:build` | exit 0, output scan clean |
| `npm run test:pgtap` (full) | PASS, 69 files, 9025 tests (an earlier run on a stack with left-over local data failed in 5 clinical files on fixture collisions; after `supabase db reset --local` and on the recycled stack it passes) |
| Vitest auth, security, api, clinics, billing, today, schedule, ci (all), config, authz | 3635 passed, 1 failed: `review2-fixes-db` "reschedule links" (date-dependent, fails on the base commit too; `deferred-items.md`) |
| e2e desktop-chrome `--retries=0`: auth, shell, today, schedule, consult, m0, journeys, a11y, pwa, design | 649 passed, 9 skipped, 1 failed (journey 5: the Today filter box matched a hidden duplicate; fixed by role locators, recheck below) |
| e2e pixel-7 + iphone-15 `--retries=0`: today/front-desk, today/today-live, shell/clinic-switcher, shell/request-budget, consult/workspace-layout | 83 passed, 14 skipped (desktop-only budget spec, golden filter) |
| Recheck after the locator fix | journeys, today, m0/consult-rx-finish, a11y/clinical-split-screens, shell/clinic-switcher on desktop-chrome + pixel-7 + iphone-15, `--retries=0`: 128 passed, 14 skipped, 0 failed |
| `npm run perf:roundtrips` | exit 0 (tables above) |

Root-caused flakes (no retries used anywhere): React 19.2 throttled Suspense reveal (fixture), Next link prefetches in the
render counter, the Today filter's hidden duplicate (role locator), the Kong marker's stalled socket — see Deviations.


## Deviations

1. **Request memo instead of React `cache()` alone.** The brief said "wrap … in React `cache()`". `cache()` does not memoise
   in Server Actions or route handlers (outside a Flight render it runs the function every time), so the memo is keyed on
   Next's per-request header store, which covers renders, actions and route handlers with one mechanism. Same intent
   (TARGET_ARCHITECTURE §2.4 "resolve once per request").
2. **Page loaders no longer detect a session revoked elsewhere** (a consequence of design point 3, approved). The
   05-11c test `tests/auth/page-revoked-session.spec.ts` was rewritten to the new contract (no session → `/login`; revoked
   → no false "Unauthenticated" error, and `/api/session-status` answers 401). `tests/auth/auth-outage-db.spec.ts` now
   models an Auth outage where the claims check needs Auth (refresh/JWKS); an outage of `GET /auth/v1/user` reaches only
   the status check. `tests/auth/active-clinic-removed-db.spec.ts`'s race case now races `getClaims`.
3. **The issue point of the cookie is Server Actions, route handlers and the status poll**, not page renders (a Server
   Component cannot set cookies). A first full load of a new session reads the context from the database once (deduped);
   the shell's on-load status check then issues the cookie.
4. **`available_slots` not batched** (no range form; a batched RPC would need migration 000121, which is avoidable).
   Concurrency + dedupe instead: same count minus the shared day, one round trip of latency.
5. **E2e race exposed by the faster server, root-caused and fixed in the test harness.** React 19.2 throttles the reveal
   of a streamed Suspense boundary (`$RC` marks it `$~`, `$RV` swaps it in up to ~300 ms later; read in Next's bundled
   `react-dom-server`); when the page hydrates inside that window the DOM briefly holds the revealed content AND its
   hidden `<div hidden id="S:n">` template (DOM probe on fresh-context loads: `hSH → Vm,hSH → Vm`). With fewer round
   trips the window became common: the first final desktop run had 35 failures, all "strict mode violation: resolved to
   2 elements" on CSS/test-id locators right after `page.goto` (consult workspace, a11y consult/billing/split screens,
   draft persistence, Rx print). Fix: the shared e2e fixture (`tests/e2e/fixtures.ts`) waits after every
   `goto`/`reload` (not `waitUntil: "commit"`) until no `S:n` template is left (bounded 5 s, never fails by itself); the
   fixture's listener is registered in `routeLoopbackOnly`, so a second user's context (journey 5's doctor) settles too;
   the Today helpers and specs take the visible board, and the Today filter box is found by role (`searchbox`), which
   excludes hidden copies (journey 5 failed on `getByLabel` matching the hidden template's input). The 6 failing spec files then passed 113/113 with
   `--retries=0`, and the full run below. No product impact (the hidden copy is never shown).
6. **Measurement tool robustness** (`kong-calls.ts`): a marker fetch on a stalled keep-alive socket once hung for
   undici's 300 s header timeout and its failure was swallowed (a 4.4 min test without an end marker). Markers are now
   bounded (5 s), retried and reported.
7. Out of scope, logged in `deferred-items.md`: `tests/security/review2-fixes-db.spec.ts` "reschedule links …" fails on
   Mondays (its +13 days lands on a Sunday); reproduced on the base commit.


## Risks

- **Staging may still sign JWTs with the legacy HS256 secret.** Then `getClaims()` calls `GET /auth/v1/user` (once per
  request after this change, plus once in the proxy) instead of verifying locally. Still a large cut, but not the full
  win. PO action P2 checks and fixes it.
- **Without `SESSION_CONTEXT_SECRET` on staging** the cookie is off: every request still reads memberships and the access
  level once (2 calls) instead of 0. PO action P1.
- **Staleness window (accepted in the design):** for at most 5 minutes after a role change or removal made elsewhere (or a
  subscription change from a webhook), the app may show the previous role's navigation or access state on that member's
  device. Every data read and write is still decided by the database at once (proof: removed-member test). The shell's
  status poll (fresh) shortens it to the next poll for removals.
- **Revoked-elsewhere sessions** (sign-out everywhere, password reset on another device) keep rendering pages until the
  next status check (on every full load, on resume, every 5 min) or the token's expiry (≤ 900 s), instead of failing on the
  next page load. Data access with such a token was already possible until expiry (PostgREST cannot see the revocation).
- **The request memo relies on Next resolving `headers()` to one object per request** (true in Next 16.4.6:
  `makeUntrackedHeaders` caches by the request store's headers). If a Next upgrade changed that, the memo would silently
  stop deduping (no wrong answers: each lookup would run again). The PR-lane budget spec would catch it.
- **The PR-lane budget spec reads `docker logs` of the local Kong container**; CI's e2e job runs the same local stack, so
  it is available there. If CI ever ran e2e without Docker access, that spec would fail loudly (not silently pass).
- `listActiveMemberships` now embeds `tenants(name, timezone)`; a clinic whose `tenants` row RLS hides from a member would
  show as "Clinic" with the default zone (same fallback as before).


## PO actions

- **P1 (staging, Vercel):** set `SESSION_CONTEXT_SECRET` on the `clinicos-staging` project (Settings → Environment
  Variables, Production environment): a fresh `openssl rand -hex 32`, its own value (not reused from any other secret), then
  redeploy. Also set it on the production project before it goes live (the app refuses to boot in production without it).
  Listed in `environment.txt.example` section B.
- **P2 (staging, Supabase):** Dashboard → Project Settings → JWT Keys. If the current signing key is "Legacy JWT secret
  (HS256)", create a standby asymmetric key (ECC P-256) and rotate to it (Supabase "JWT signing keys" guide; existing
  sessions keep working, the legacy key stays as a verification key). Quick check from any browser:
  `https://<staging-ref>.supabase.co/auth/v1/.well-known/jwks.json` lists an `"alg":"ES256"` key once it is done. Without
  this, each request still makes one or two `/auth/v1/user` calls.
- **P3:** after P1 and P2, re-check staging by feel (Today, Schedule week, Patients, a patient, a consult): a click should
  cost about 1 round trip per page-data query instead of ~25.



## 09D-01a: review fix round (2026-11-23)

Inputs: `09D-REVIEW-A.md` (isolated), `09D-REVIEW-SEC.md` (adversarial), `09D-REVIEW-TRIAGE.md` (work list, ruling R-S; the
Outcome table there is filled per ID). Base `3b086857`; final code and test tree `fd6aa691` (the docs commit follows). No migration, no new dependency.

### Commits

| Commit | ID | What |
| --- | --- | --- |
| `d7057bae` | A-6 | reschedule cases no longer depend on the weekday (own commit, date reasoning in the message) |
| `e5700f67` | A-3 (A-8) | only `/api/session-status` issues the session-context cookie |
| `2334f532` | R-S (A-1, S-1, A-2, S-2) | sensitive actions get a fresh liveness, membership and access check |
| `4d6eccec` | S-5 | `__Host-clinic_ctx` on Secure requests |
| `231a7081` | S-7 | a proxy answer that expires the context cookie is `private, no-store` |
| `6859e16b` | S-6 | session claims need this project's `iss`, `aud` and `role` `authenticated` |
| `6235f477` | S-4 | `SESSION_CONTEXT_SECRET` must not reuse another secret's value |
| `404d1742` | A-4 | revoked-session pages pin their outcome |
| `67281f76` | A-5 | deterministic request-budget spec |
| `27ac23ec` | A-7 | the dashboard layout redirects to /login only when the session is missing |
| `9048fd19` | A-9 | the access pages read the access level fresh |
| `a04fa3c8` | A-10 | a failed clinic time-zone read is not memoised for the request |
| `00d92dd8` | A-11 | the schedule's day and week slot calls go out in one round |
| `2a50a237` | A-14 | cookie-off paths and one shared request scope |
| `40854795` | R-S | the perf report measures a sensitive action |
| `fd6aa691` | A-5 | budget spec waits through the shell's first status retry and holds live refreshes; corrects `67281f76`'s stream claim |

Each fix commit typechecks on its own (built stage by stage from the base, `tsc` app + tests at every stage).

### Design as built

**Ruling R-S (`lib/auth/sensitive-actions.ts`, the one place the list lives).** 24 entry points under 23 action keys:
staff invite / resend / revoke / remove / role edit; API key create / revoke; webhook subscription create / delete (no
rotate or update action exists); the in-app DPDP export route (`GET /api/patients/[id]/export`); clinic settings, statutory,
Rx print and profile writes (the profile form action and its service); billing writes (create invoice, add / delete item,
record payment, collect payment, complete-and-bill); password change and reset completion; the AI SOAP action (the only AI
gateway entry point). The guards (`requireServiceContext`, `resolveServiceContext`, `requirePermission`) take
`{ sensitive: <action> }` and then:

1. read the membership and role from the database (`getActiveMembership(…, { fromDatabase: true })`: never the cookie; the
   request memo holds only database answers);
2. check the role (a refused role touches nothing but `memberships`, as the guard suite requires);
3. ask `session_is_live()` (migration 000087) and `my_tenant_access` **together** (one round trip); a revoked session is
   refused (`UnauthenticatedError` → the existing "Unauthenticated" answers, 401 on the route) before a locked clinic; an
   RPC error is `AuthUnavailableError` (generic failure / 503, never a sign-out).

The two account actions act on the caller's own Auth account with or without a clinic, so they get check 3's liveness
only (`lib/auth/session-live.ts`), right after input validation and before the freshness rule, the breached-password check
and `updateUser`. Everything else keeps the fast path (claims + cookie). Out of the list by design: the `/api/v1` API-key
routes (DPDP export and erasure there; erasure has no session entry point), whose control is the key.

Cost: a listed action costs exactly **one more call than the database path** (`session_is_live`, in the same round as
`my_tenant_access`) and at most three more than the cookie path (`memberships`, then `my_tenant_access` ∥ `session_is_live`:
two rounds). Measured: +2 on Save printing settings, whose membership read is shared with its own re-render (perf table
below). The `sensitive-actions-db` live control pins one `session_is_live` and one `my_tenant_access` per listed call.

**A-3.** `getTenantAccessLevel` no longer sets `clinic_ctx`; the memo's "resolved from the database" record and the
`peekRequestMemo` / `setRequestMemo` helpers are gone (so A-8's explicit-clinic/pin mismatch has no code path left).
`/api/session-status` is the only issuer. `forgetSessionContext` now expires a name only when the device holds it (no
`Set-Cookie`, so no revalidation, on an action whose device had none). Effect: a device whose cookie has expired reads the
context from the database (2 calls) on each request until the next status poll (on load, resume, `online`, every 5 min
while visible); before, the first action re-issued it at the price of a full route re-render.

**S-5.** On a Secure request the cookie is `__Host-clinic_ctx` (Secure, Path=/, no Domain), the only name read there; plain
http (localhost, the e2e server) keeps `clinic_ctx`. The sign-out route, the proxy and `forgetSessionContext` expire
whichever name is present (the `__Host-` one with Secure and Path=/, as a browser requires).

**S-6.** `getSessionClaims` refuses a token unless `iss` = `<NEXT_PUBLIC_SUPABASE_URL>/auth/v1` (trailing slash ignored),
`aud` is or contains `authenticated`, and `role` = `authenticated` (log line `auth.claims.refused` with `reason`
`claim_iss|claim_aud|claim_role`, never a value). Local Auth's issuer is `http://127.0.0.1:54321/auth/v1` (container env
`GOTRUE_JWT_ISSUER`), matching the lanes' `NEXT_PUBLIC_SUPABASE_URL`.

**S-4.** The env schema refuses a `SESSION_CONTEXT_SECRET` equal to any other credential-shaped key it knows
(`SECRET_ENV_NAMES`: `CRON_SECRET`, `JOBS_RUNNER_SECRET`, `SEND_EMAIL_HOOK_SECRET`, `MSG91_WEBHOOK_SECRET`, `ERROR_INGEST_KEY`,
`SUPABASE_SECRET_KEY`, …), in every tier, naming the other key only.

**S-7.** The status poll's issuing 200 was already `private, no-store, max-age=0` (now pinned); the sign-out route's answers
are `no-store`; the proxy sets `private, no-store` on any answer that expires the cookie; Server Actions no longer set it.

**Lows.** A-7: only `UnauthenticatedError` redirects the layout to /login (`unstable_rethrow` first; an outage or any other
failure reaches the error boundary). A-9: the three access pages read the level `fresh`. A-10: `requestMemo(…, { keep })`;
the zone's fallback is handed to its own callers and dropped, so the next reader in the request asks again. A-11: day and
week `available_slots` calls all start before either is awaited. A-15 (no code): a one-clinic device's `pin: ""` context
stays valid for its TTL if the user joins a second clinic elsewhere; harmless (still a valid membership) and the next
status poll pins the clinic.

### A-4 root cause (found while fixing)

The rewritten 09D spec's revoked-session cases were not revoked-session cases at all: its precondition called
`owner.client.auth.getUser()`, and auth-js removes the client's local session when GoTrue answers `session_not_found`, so
every later page ran with **no session** and redirected to /login, which the old `if (err !== null)` branch accepted. The
precondition now asks GoTrue through the admin client; each page has a pinned outcome (list pages render, the two record
pages 404 for an id that is no record), plus a sensitive action refused for that session.

### A-5: what made the budget spec non-deterministic (found while fixing)

- **The precondition race (proven).** The zero-call budgets need the device's `clinic_ctx`, which only the shell's
  on-load `/api/session-status` issues. If that first check fails or is slow (a loaded runner), the shell retries only
  after 15-22.5 s (`RETRY_DELAYS_MS[0]` with jitter). Scenario run (first status answer forced to 503): without the wait
  the in-app window counts `memberships` 2 and `my_tenant_access` 2, the reviewer's failure; with the wait (bound 30 s,
  covering the retry) it passes, twice. Each test also clears a `clinic_ctx` inherited from the setup's sign-in (it could
  expire inside a window), so the measured requests use this page's own check.
- **Live refreshes inside a window (found in the scenario's traces).** The Today board's live refresh (a Realtime signal,
  or its 20 s poll until the channel is SUBSCRIBED) and the shell's resume refresh call `router.refresh()` after an
  `/api/health` probe. A refresh re-renders the route and re-prefetches the nav links: a second Today render and a patient
  page prefetch landed in measured windows (`memberships` 3 on Today, 1 on Patients). They are page data with their own
  timing, so the spec holds them while it measures (the probe is refused; the screen stays as it is, by design).
- **Correction:** `67281f76` says Kong writes its access lines to both stdout and stderr. That is wrong: it was a zsh
  MULTIOS artefact in my probe (`2>&1 >/dev/null |` tees stdout into the pipe). Node's `spawnSync` shows the marker on stdout
  only (1) and an empty stderr (0). Reading stdout only stays, for the reviewer's reason (stderr is the error log; a marker
  path quoted there would break the window's order). `fd6aa691` fixes the comments. The container name comes from
  `supabase/config.toml`, a failed `docker logs` is retried within the 10 s bound, and `retries: 0`.

### Proofs: fails-without (one mutation at a time, run, expect red, restore, `cmp`)

Driver: a scratch script applied one mutation, ran the named specs, restored the file from a byte copy and ran `cmp`
(0 = identical); afterwards `git diff --exit-code HEAD` was clean. Tool output (counts are the failing / total tests of the
named specs):

| # | ID | Mutation (behaviour removed) | Result of the named specs | Red tests (examples) | `cmp` |
| --- | --- | --- | --- | --- | --- |
| 1 | R-S | liveness check skipped in the guards (`lib/auth/context.ts`) | RED: 44 failed, 8 passed (52) (sensitive-actions-db.spec.ts) | control, live session + valid cookie: 'app/(dashboard)/settings/clinic; control, live session + valid cookie: 'app/api/patients/[id]/export/ro | 0 |
| 2 | R-S | membership and role from the cookie on a listed action (`lib/auth/context.ts`) | RED: 44 failed, 8 passed (52) (sensitive-actions-db.spec.ts) | A-2: a member demoted elsewhere is refused a listed action by the fres; control, live session + valid cookie: 'app/(dashboard)/settings/clinic | 0 |
| 3 | R-S | access level from the cookie on a listed action (`lib/auth/context.ts`) | RED: 44 failed, 8 passed (52) (sensitive-actions-db.spec.ts) | control, live session + valid cookie: 'app/(dashboard)/settings/clinic; control, live session + valid cookie: 'app/api/patients/[id]/export/ro | 0 |
| 4 | R-S | createApiKey drops its { sensitive } flag (`features/api-keys/actions.ts`) | RED: 3 failed, 72 passed (75) (sensitive-actions-db.spec.ts) | A-2: a member demoted elsewhere is refused a listed action by the fres; control, live session + valid cookie: 'features/api-keys/actions.ts#cr | 0 |
| 5 | R-S | the DPDP export route drops its flag (`app/api/patients/[id]/export/route.ts`) | RED: 2 failed, 50 passed (52) (sensitive-actions-db.spec.ts) | control, live session + valid cookie: 'app/api/patients/[id]/export/ro; revoked session + valid cookie: 'app/api/patients/[id]/export/route.ts | 0 |
| 6 | R-S (S-2) | generateSoapAction drops its flag (`features/ai/actions.ts`) | RED: 5 failed, 62 passed (67) (ai-containment.spec.ts, sensitive-actions-db.spec.ts) | control, live session + valid cookie: 'features/ai/actions.ts#generate; revoked session + valid cookie: 'features/ai/actions.ts#generateSoapAc | 0 |
| 7 | R-S | changePassword skips the liveness check (`features/auth/service.ts`) | RED: 3 failed, 74 passed (77) (password-service.spec.ts, sensitive-actions-db.spec.ts) | changePassword: session_is_live false → session_not_found; an RPC erro; control, live sessions: the password change and the reset completion g | 0 |
| 8 | A-3 | getTenantAccessLevel issues the cookie again after a database read (`lib/auth/tenant.ts`) | RED: 1 failed, 12 passed (13) (session-context-db.spec.ts) | A-3: a Server Action or route handler that read the context from the d | 0 |
| 9 | S-5 | the bare name is read on a Secure request (`lib/auth/tenant.ts`) | RED: 1 failed, 12 passed (13) (session-context-db.spec.ts) | S-5: on a Secure request the cookie is __Host-clinic_ctx, and only tha | 0 |
| 10 | S-5 | the status poll issues the bare name on a Secure request (`lib/auth/tenant.ts`) | RED: 1 failed, 12 passed (13) (session-context-db.spec.ts) | S-5: on a Secure request the cookie is __Host-clinic_ctx, and only tha | 0 |
| 11 | S-5 | the sign-out route expires only the bare name (`app/auth/signout/route.ts`) | RED: 1 failed, 27 passed (28) (signout-route.spec.ts) | 09D-01a (S-5): the __Host- name is expired too, with Secure and Path=/ | 0 |
| 12 | S-5 | the proxy does not expire the __Host- name (`proxy.ts`) | RED: 1 failed, 10 passed (11) (session-auth-close-db.spec.ts) | 09D-01a (S-5, S-7): the __Host- name is expired with Secure and Path=/ | 0 |
| 13 | S-7 | the proxy's expiring answer is cacheable (`proxy.ts`) | RED: 1 failed, 10 passed (11) (session-auth-close-db.spec.ts) | 09D-01a (S-5, S-7): the __Host- name is expired with Secure and Path=/ | 0 |
| 14 | S-7 | the status poll's issuing 200 without private, no-store (`app/api/session-status/route.ts`) | RED: 1 failed, 12 passed (13) (session-context-db.spec.ts) | the status poll issues the cookie: ids, role and state only, 5 min, Ht | 0 |
| 15 | S-6 | claims accepted without the iss/aud/role checks (`lib/auth/tenant.ts`) | RED: 9 failed, 3 passed (12) (session-claims.spec.ts) | no session (a definitive answer) → redirect('/login'); an audience list without authenticated → UnauthenticatedError, logged  | 0 |
| 16 | S-4 | a reused SESSION_CONTEXT_SECRET is accepted (`lib/env.ts`) | RED: 6 failed, 283 passed (289) (env-schema.spec.ts) | SESSION_CONTEXT_SECRET equal to CRON_SECRET throws in every tier, nami; SESSION_CONTEXT_SECRET equal to ERROR_INGEST_KEY throws in every tier, | 0 |
| 17 | A-4 | every page asks Auth again (revoked pages redirect to /login) (`lib/auth/tenant.ts`) | RED: 10 failed, 13 passed (23) (page-revoked-session.spec.ts) | revoked session: /consultation/[id] answers async function Authenticat; revoked session: /patients answers async function AuthenticatedPage(pr | 0 |
| 18 | A-6 | review2: the seven-day week is not set (`tests/security/review2-fixes-db.spec.ts`) | RED: 1 failed, 19 passed (20) (review2-fixes-db.spec.ts) | reschedule links: only the hash is stored and the raw link still works | 0 |
| 19 | A-6 | review-fixes AR-L2: the seven-day week is not set (`tests/security/review-fixes-db.spec.ts`) | green: 19 passed (19) (see note) | - | 0 |
| 20 | A-7 | the layout sends every non-outage failure to /login (as before) (`app/(dashboard)/layout.tsx`) | RED: 1 failed, 11 passed (12) (session-claims.spec.ts) | an unexpected failure (a bug, a broken client) is rethrown, never a si | 0 |
| 21 | A-9 | the access pages read the level from the cookie (`lib/auth/access-page.ts`) | RED: 1 failed, 12 passed (13) (session-context-db.spec.ts) | A-9: the access pages read the level from the database, never from the | 0 |
| 22 | A-10 | the zone fallback is memoised (`lib/datetime/server.ts`) | RED: 1 failed, 2 passed (3) (request-memo.spec.ts) | a transient failure: the default zone for that reader, the clinic's re | 0 |
| 23 | A-11 | the day and week slot calls in two rounds (as before) (`features/schedule/queries.ts`) | RED: 1 failed (1) (schedule-slot-round.spec.ts) | the day grid's and the week strip's calls all start before any answers | 0 |
| 24 | A-14 | the cookie stays on without a usable secret (`lib/auth/tenant.ts`) | RED: 1 failed, 12 passed (13) (session-context-db.spec.ts) | A-14: with no secret, or an environment the schema refuses, nothing is | 0 |
| 25 | A-14 | the request memo never memoises (`lib/auth/request-memo.ts`) | RED: 3 failed, 10 passed (13) (session-context-db.spec.ts) | A-14: within one real request scope (one shared headers object), the l; A-3: a Server Action or route handler that read the context from the d | 0 |

A-4 vacuity check: under mutation 17 the 09D version of `page-revoked-session.spec.ts` (from `3b086857`) **passes 22/22**,
the new one fails 10 of 23: the old spec could not see the regression. A-6: mutation 19 stays green today (Monday: +12 is a
Saturday); it fires on Tuesdays (+12 = Sunday), as review2's +13 fires today (mutation 18, red) and its +11 on Thursdays.
A-5: the old two-stream reader put back (stdout + stderr) keeps the spec green (11/11), because stderr carries no access
lines, so it is no proof. The fails-without proof is the scenario above: with the first status check forced to 503 the spec
**without** the cookie wait is red (`{"GET /rest/v1/memberships":2,"POST /rest/v1/rpc/my_tenant_access":2,…}`, 2 of 11
failed), and **with** it green (11/11, twice). Both variants were built from the final spec, run, and the spec restored
(`cmp` 0).

### Round trips: before (09D final, `3b086857`) vs after (app sources of `40854795` = `fd6aa691`)

`npm run perf:roundtrips` twice: on the final tree, and on a build of the base app sources (`app features lib proxy.ts`
of `3b086857` checked out over this branch, rebuilt, measured, then `git checkout HEAD --` and `git diff --exit-code` clean;
the bundle was rebuilt from the final sources afterwards). The same test code (median of 3 per page) measured both. Raw:
`test-results/perf-roundtrips/summary.{md,json}` of each run (copies kept with the scratch logs).

**Per page: 0 of 28 rows changed** (total server calls and the identity/context calls alike, equal to the 09D "After"
table above). **Check in** (fast path): 11 → 11, the same calls by path. **Save printing settings** (a listed action,
`clinic_settings.rx_print`): 5 → 7, i.e. `my_tenant_access` +1 and `session_is_live` +1. The guard's membership read
is shared, within the same request, with the re-render the action triggers, so `memberships` stays at 2. Against the
database path (no cookie) a listed action costs exactly one more call (`session_is_live`, in the same round as
`my_tenant_access`); against the cookie path it costs those two.

| Role | Navigation | Page | 09D final `3b086857` | 09D-01a final | identity/context calls (user / memberships / my_tenant_access / session_is_live), before → after |
| --- | --- | --- | --- | --- | --- |
| receptionist | full load | /today | 10 | 10 | 1 / 3 / 1 / 0 → 1 / 3 / 1 / 0 |
| receptionist | full load | /schedule (day) | 14 | 14 | 1 / 3 / 1 / 0 → 1 / 3 / 1 / 0 |
| receptionist | full load | /schedule?view=week | 21 | 21 | 1 / 3 / 1 / 0 → 1 / 3 / 1 / 0 |
| receptionist | full load | /patients | 8 | 8 | 1 / 2 / 1 / 0 → 1 / 2 / 1 / 0 |
| receptionist | full load | /patients/[id] | 17 | 17 | 1 / 3 / 1 / 0 → 1 / 3 / 1 / 0 |
| receptionist | full load | /billing/register | 10 | 10 | 1 / 3 / 1 / 0 → 1 / 3 / 1 / 0 |
| receptionist | full load | /settings/clinic | 9 | 9 | 1 / 3 / 1 / 0 → 1 / 3 / 1 / 0 |
| receptionist | in-app | /today | 4 | 4 | 0 / 1 / 0 / 0 → 0 / 1 / 0 / 0 |
| receptionist | in-app | /schedule (day) | 8 | 8 | 0 / 1 / 0 / 0 → 0 / 1 / 0 / 0 |
| receptionist | in-app | /schedule?view=week | 15 | 15 | 0 / 1 / 0 / 0 → 0 / 1 / 0 / 0 |
| receptionist | in-app | /patients | 2 | 2 | 0 / 0 / 0 / 0 → 0 / 0 / 0 / 0 |
| receptionist | in-app | /patients/[id] | 11 | 11 | 0 / 1 / 0 / 0 → 0 / 1 / 0 / 0 |
| receptionist | in-app | /settings/clinic | 3 | 3 | 0 / 1 / 0 / 0 → 0 / 1 / 0 / 0 |
| doctor | full load | /today | 13 | 13 | 1 / 3 / 1 / 0 → 1 / 3 / 1 / 0 |
| doctor | full load | /schedule (day) | 13 | 13 | 1 / 3 / 1 / 0 → 1 / 3 / 1 / 0 |
| doctor | full load | /schedule?view=week | 20 | 20 | 1 / 3 / 1 / 0 → 1 / 3 / 1 / 0 |
| doctor | full load | /patients | 8 | 8 | 1 / 2 / 1 / 0 → 1 / 2 / 1 / 0 |
| doctor | full load | /patients/[id] | 18 | 18 | 1 / 3 / 1 / 0 → 1 / 3 / 1 / 0 |
| doctor | full load | /consultation/[id] | 23 | 23 | 1 / 2 / 1 / 0 → 1 / 2 / 1 / 0 |
| doctor | full load | /billing/register | 15 | 15 | 1 / 5 / 1 / 0 → 1 / 5 / 1 / 0 |
| doctor | full load | /settings/clinic | 9 | 9 | 1 / 3 / 1 / 0 → 1 / 3 / 1 / 0 |
| doctor | in-app | /today | 7 | 7 | 0 / 1 / 0 / 0 → 0 / 1 / 0 / 0 |
| doctor | in-app | /schedule (day) | 7 | 7 | 0 / 1 / 0 / 0 → 0 / 1 / 0 / 0 |
| doctor | in-app | /schedule?view=week | 14 | 14 | 0 / 1 / 0 / 0 → 0 / 1 / 0 / 0 |
| doctor | in-app | /patients | 2 | 2 | 0 / 0 / 0 / 0 → 0 / 0 / 0 / 0 |
| doctor | in-app | /patients/[id] | 11 | 11 | 0 / 1 / 0 / 0 → 0 / 1 / 0 / 0 |
| doctor | in-app | /consultation/[id] | 16 | 16 | 0 / 0 / 0 / 0 → 0 / 0 / 0 / 0 |
| doctor | in-app | /settings/clinic | 3 | 3 | 0 / 1 / 0 / 0 → 0 / 1 / 0 / 0 |

| Role | Server action | 09D final `3b086857` | 09D-01a final | 09D final by path | 09D-01a by path |
| --- | --- | --- | --- | --- | --- |
| receptionist | Check in (Today) | 11 | 11 | GET /rest/v1/tenants ×4; GET /rest/v1/memberships ×4; GET /rest/v1/visits ×2; POST /rest/v1/rpc/check_in_visit ×1 | GET /rest/v1/tenants ×4; GET /rest/v1/memberships ×4; GET /rest/v1/visits ×2; POST /rest/v1/rpc/check_in_visit ×1 |
| owner | Save printing settings (sensitive) | 5 | 7 | GET /rest/v1/memberships ×2; PATCH /rest/v1/tenants ×1; POST /rest/v1/rpc/log_audit ×1; GET /rest/v1/tenants ×1 | GET /rest/v1/memberships ×2; POST /rest/v1/rpc/my_tenant_access ×1; POST /rest/v1/rpc/session_is_live ×1; PATCH /rest/v1/tenants ×1; POST /rest/v1/rpc/log_audit ×1; GET /rest/v1/tenants ×1 |

### Verification on the final tree

All after the second `npm run stack:recycle` (tool output in the scratch logs). Static checks, pgTAP and Vitest ran on `40854795`; `fd6aa691` changed only the budget spec and the Kong reader's comments, which the 10/10 re-run covers.

| Check | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npx eslint .` | exit 0 (0 errors, 390 warnings: 09D's count; the 4 in touched files predate 09D-01a) |
| `npm run inventory` | exit 0 (27 "use server" modules, 122 exports, 34 route modules, 0 flagged) |
| `npm run ci:ui-policy` / `npm run ci:ai-l1` | PASS / PASS |
| `node scripts/ci/env-example.mjs --check` | `.env.example` matches `lib/env.ts` |
| `npm run test:pgtap` (full) | PASS, 69 files, 9025 tests |
| Vitest auth, security, api, clinics, billing, today, schedule, ci (whole), config, authz, ai, dpdp, staff | 150 files, 3786 passed, 0 failed |
| `npm run e2e:build` | exit 0, output scan clean |
| e2e desktop-chrome `--retries=0`: auth, shell, today, schedule, consult, m0, journeys, a11y, pwa, design, settings | 652 passed, 9 skipped, 0 failed (18.4 min; tree `40854795` + the budget spec of `67281f76`) |
| e2e pixel-7 + iphone-15 `--retries=0`: shell/request-budget, shell/clinic-switcher, shell/route-states, schedule, settings, m0/checkout-collect, consult/rx-print, today/today-live, auth | 60 passed, 11 skipped (desktop-only cases), 0 failed |
| `tests/e2e/shell/request-budget.spec.ts`, desktop-chrome `--retries=0`, 10 separate runs in a row | 10/10 green on `67281f76`'s version, and again 10/10 on the final `fd6aa691` version (11 passed each: 8 setup + 3) |
| `npm run perf:roundtrips` (final, and base build) | exit 0 / exit 0 (14 passed each) |

**Flake root-caused: the host slept.** The first desktop run (22 failures: 30-90 s timeouts, a 5 s wait that took 90 s,
`Invalid Refresh Token: Already Used`) overlapped repeated macOS idle sleeps on battery (`pmset -g log`: "Entering Sleep
state due to 'Maintenance Sleep'" from 17:10 to 18:17 IST, during the run). The run was stopped and repeated under
`caffeinate -dimu` (macOS built-in, keeps the machine awake): 0 failures. No product or test change came from it. Every later
e2e run used `caffeinate`.

### Deviations

1. **Billing writes include the front-desk payment actions.** R-S lists "billing and subscription writes"; no in-app
   subscription write exists, so the list takes every billing write the app has: create invoice, add / delete item, record
   payment, collect payment and complete-and-bill (the doctor's Sign & Bill). These are frequent: each now costs one
   liveness call plus the database membership and level reads (two rounds) instead of the cookie path. If the PO wants
   only money-moving or administrative billing writes on the list, it is one line each in `lib/auth/sensitive-actions.ts`.
2. **Invitation resend and revoke are on the list** as part of "staff management: invite" (a resend issues a new link).
3. **Account actions get liveness only**, not the membership and access-level reads: password change and reset act on the
   user's own Auth account with or without a clinic (guard kind `self`), and a locked clinic must not block a password
   change. Liveness runs right after input validation (before the A00-5 freshness rule), so a plain password session
   exercises it; minting an emailed-code session in a test is lint-banned (AUTH-01: `admin.generateLink`).
4. **A-8 fixed by removal** (with A-3): no separate test, the code path no longer exists.
5. **A-5's "skip locally without docker" not done:** the spec fails with a clear message instead (CI has docker).
6. **Perf report gains one measured action** (the owner's Save printing settings, a listed action), so the added calls are
   measured rather than inferred.
7. **The budget spec holds the live views' background refreshes** while it measures (A-5, `fd6aa691`): a test-side
   change, so the counts are the navigation's own.
8. **A commit message is wrong** (`67281f76`, the two-stream claim). It is corrected in `fd6aa691` and here; history was
   not rewritten.
9. Lows left (reasons in the triage Outcome and `deferred-items.md`): A-12, A-13.

### Risks

- **S-6 on hosted projects.** If a hosted project's token `iss` is not exactly `<NEXT_PUBLIC_SUPABASE_URL>/auth/v1` (for
  example a custom Auth domain that differs from the app's Supabase URL), every page would treat the session as signed
  out. Expected to match on staging (`https://<ref>.supabase.co/auth/v1`); the `auth.claims.refused` log line names the
  failing claim. PO action P4 checks it on the first staging deploy.
- **Payment and Sign & Bill latency** (deviation 1): on staging each such click gains about one round trip (~300–450 ms;
  measured locally: `session_is_live` and `my_tenant_access` in one round, the membership read shared with the re-render)
  until 09E.
- **Cookie gaps after A-3:** a device whose cookie expired between polls reads the context from the database (2 calls per
  request) until the next poll; the 5-min poll and the 300 s TTL line up, so the gap is short, but not zero.
- The database still accepts a revoked-but-unexpired JWT on raw PostgREST calls (no regression; V2-14 backlog).

### PO actions

- **P4 (new, staging):** after the next staging deploy, sign in and open Today; if it bounces to /login, check the Vercel
  logs for `auth.claims.refused` (`reason: claim_iss`) and tell Claude the reason code (no token or URL needed).
- **P5 (new):** confirm or narrow deviation 1 (which billing writes are "sensitive").
- **P6 (new):** add the database-side liveness check (S-1's stronger option) to the V2-14 backlog (§10), per ruling R-S.
- P1–P3 above are unchanged.
