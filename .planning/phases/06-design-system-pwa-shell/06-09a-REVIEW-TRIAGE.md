# 06-09a Wave A review triage (V2-06)

Reviewed commit `ef24000`. Three fresh reviewers; reports in `reviews/`: `v206a-review-independent.md` (IND),
`v206a-review-adversarial-pwa.md` (A: service worker, public paths, no-store, sign-out),
`v206a-review-adversarial-client-errors.md` (C: client error capture, report artefacts). Triage by the orchestrator
as CTO (PO delegated rulings; speed ruling 2026-11-14: Highs and Mediums fixed with a test that fails without the fix
and a fresh re-verification, because this area is security-sensitive; Lows fixed only when cheap).

Fix plan: **06-09a** (application only, no migration).

## High

| ID | Source | Finding | Fix |
|---|---|---|---|
| H-WEBKIT | A H-1 | On WebKit (iPhone, iPad, Safari) `hardSignOut()` never finishes: the manual-redirect POST to `/auth/signout` never settles and its `AbortSignal.timeout` never fires, so purge and `location.replace("/login")` never run; the patient screen stays up | One overall deadline with a real timer raced against the server call; purge + replace always run (`finally`); the route answers `fetch` callers with a non-redirect response (e.g. 204 + `Clear-Site-Data`, or JSON) while form posts keep the 303; no `AbortSignal.timeout` dependency (IND L-1, A L-2). The spec 5 exit paths run on the WebKit `iphone-15` project in the PR lane |

## Medium

| ID | Source | Decision |
|---|---|---|
| M-EVERYWHERE | IND M-1, A M-1 | "Sign out of all devices" reports success only when the global revocation succeeded: the route returns a failure status when GoTrue errors; the client never falls back silently — it signs this device out and tells the user the other devices could not be signed out (fixed text, retry). Test: device 2 is signed out, or the user sees the failure |
| M-TABS | A M-2 | Signing out in one tab purges and redirects every other open tab (BroadcastChannel with a `storage`-event fallback); a tab that receives the signal never acts under new cookies. Test: second tab leaves the patient screen within 2 s |
| M-ERRCAP | IND M-2, C M-1, C M-2 | Client error reports accept only a fixed allow-list of error class names and the app's own route patterns (generated from the route tree, checked by a test); anything else is counted under one fixed key. Removes free text and bounds distinct keys globally, so no migration is needed. Ruling: R-3 stands (no tenant/user ids on client rows) |
| M-OFFLINE | IND M-3 | `sw.js` carries a build stamp so each deploy installs a new worker; the precache is versioned and old caches are deleted on activate; `/offline` is self-contained (its CSS inlined or precached with it). Test: after a second build the installed worker serves the new `/offline` styled |
| M-GUARD | IND M-4, A L-1 | The sign-out guard does not exempt files by folder: `auth.signOut` (any spelling the rule can see, including computed access and direct logout fetches) is allowed only in `hardSignOut()` and an explicit list of server files; `features/auth/password-flows.ts` signs out through `hardSignOut()` |

## Lows fixed in 06-09a (cheap)

A L-3 (a stronger sign-out reason during a running one escalates instead of being dropped); IND L-2 (titles carry the
brand once); IND L-4 (offline banner time from the last successful response); IND L-5 (`serverEnv()` guarded in the
dashboard layout); IND L-6 + A Info (server-ended sessions — proxy revocation, global sign-out after password reset,
signing in over a live session — purge the device on arrival at `/login`); C L-1 (per-key repeat debounce per instance);
C L-2 (a dropped report writes one counter log line); C L-3 (a failed Lighthouse run's raw output is scrubbed before it
is thrown or logged); C Info (`docs/runbooks/error-sink.md` updated; the onboarding boundary not reporting recorded as a
deviation in the 06-04a record).

## Accepted / assigned

| Item | Reason | Owner |
|---|---|---|
| IND L-3: v1 sidebar, drawers and footers lack safe-area padding | The shell is rebuilt in 06-04b | 06-04b |
| A Info: static cache keeps route chunks across users | Code only, no PHI; reveals which screens exist, not data | — (accepted) |
| C Info: Lighthouse reports embed screenshots of `/patients` and `/consultation` | Synthetic data only; artefacts stay local or are uploaded only after the scrub check | — (accepted) |
| C Info: secret list misses tokens decoded from the session cookie | Cheap: added to the scrub list in 06-09a if it is a one-line change; otherwise V2-14 | 06-09a / V2-14 |
