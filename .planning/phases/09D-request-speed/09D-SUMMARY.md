# V2-09d Request speed: summary

**Outcome:** a page or a click now asks Supabase for far fewer things, because who the user is and which clinic they are in is resolved once, not in every guard:
- Identity comes from the verified token without a network call, and one request memo shares the membership and access level.
- A signed 5-minute cookie lets the next request skip the membership and access lookups. The database still decides every read and write.
- A closed list of sensitive actions always gets a fresh liveness, membership and access check.

Branch `v2/phase-09d-request-speed`, PR #18 into `feature/v2`, merged as `d884b22`. No migration, no new dependency.

## What shipped

| Part | Commits | Changes |
|---|---|---|
| Round-trip report | `f2b1f624`, `b31b5b66` | `npm run perf:roundtrips`: Supabase calls per page, in-app and full load, and per action, counted from the local Kong log |
| Request memo and claims | `6ca75bfe` | `getSessionClaims()` reads the session with `getClaims()`; `requestMemo` (`lib/auth/request-memo.ts`) is keyed on Next's per-request header store, so it works in renders, Server Actions and route handlers (React `cache()` alone does not); one membership query also gives the clinic name and zone |
| Session-context cookie | `e45f5b85`, `6ca75bfe` | `clinic_ctx`, HMAC-signed with the new `SESSION_CONTEXT_SECRET`, 300 s, bound to user, session and active clinic; refused on a bad MAC or expiry; cleared on sign-out, clinic switch and role or staff edits |
| Schedule | `ebdb64e5` | `available_slots` calls for every (doctor, date) go out together, each pair once; not batched into one RPC (needs a migration) |
| PR-lane call ceiling | `b31b5b66`, `26fab3d2` | `tests/e2e/shell/request-budget.spec.ts` blocks a return of the identity and context calls |
| E2E harness | `720be42c`, `673b98b8`, `7aad6213`, `66478f5d`, `7c7b2302` | The faster server exposed React 19.2's throttled Suspense reveal; fixtures wait for it. Today locators take the visible board; Kong markers are bounded and retried |
| Fix round 09D-01a | 16 commits, `d7057bae` to `fd6aa691` | Ruling R-S (24 sensitive entry points, `lib/auth/sensitive-actions.ts`); only `/api/session-status` issues the cookie; `__Host-` prefix on Secure; claims need this project's `iss`, `aud`, `role`; `private, no-store`; `SESSION_CONTEXT_SECRET` must differ from other secrets; revoked-session specs pin real outcomes; deterministic budget spec; weekday-proof reschedule tests; Lows A-7, A-9, A-10, A-11, A-14 |
| Evidence and CI fixes | `c9ce9cde`, `fbacebe9`, `68d9cc1b` | Two route-spec mocks fail `getClaims`; an allergy pgTAP test counts only its own clinic's audit rows; axe scans settle inside an animation frame (WebKit flake, test-only); the CDCI seed script reads files whole on Node 24 |

## Results (local, app-server Supabase calls, base `0acb544c` to final)

| Navigation | Before | After |
|---|---|---|
| Receptionist, full load, /today | 26 | 10 |
| Receptionist, full load, /schedule?view=week | 38 | 21 |
| Receptionist, full load, /patients | 27 | 8 |
| Receptionist, full load, a patient | 43 | 17 |
| Doctor, full load, /consultation/[id] | 59 | 23 |
| Receptionist, in-app, /patients | 10 | 2 |
| Receptionist, Check in (Today) | 34 | 11 |

Staging pays about 300 to 450 ms per call, so the count is what a click costs. Local milliseconds are not a staging figure.
The full table is in `09D-NOTES.md`. The fix round changed none of the 28 page rows; it added 2 calls to Save printing settings (5 to 7), a listed action.

## Behaviour changes users may notice

- Pages open with fewer waits. On staging this needs the secret (09D-P1) and ES256 signing keys (09D-P2).
- A session revoked on another device is no longer refused by a page load. The shell's status check (on load, resume, every 5 min) signs the device out. Sensitive actions refuse it at once.
- A removed or demoted user's own device can show old navigation for up to 300 s. Their data is refused at once.
- Listed sensitive actions, including billing writes (payments, Sign & Bill), cost one more round trip until 09E.
- On https the cookie is `__Host-clinic_ctx`.
- Production refuses to boot without `SESSION_CONTEXT_SECRET`.

## Backlog added (owner)

| Item | Owner |
|---|---|
| Database-side liveness check (`session_is_live()` in the definer commands and the `api_keys` and `webhook_subscriptions` insert rules); raw PostgREST still accepts a revoked, unexpired token (not a regression) | PO decision (09D-P6); V2-14 |
| Receipt PDF doctor-name fallback and profile email or phone read the token's claims, stale up to 900 s (A-12) | V2-10 |
| E2E fixture can wrap `goto` twice and swallows its 5 s reveal timeout (A-13) | 09E latency lane reporting |
| Page-data duplicates: Today and Schedule read `tenants` twice; week view needs one `available_slots` per day; Patients links prefetch one patient read per row; Check in renders twice | 09E |
| Keyboard Rx entry race: typed medicine text right after adding a line can be wiped (about 1 in 20 locally on a loaded machine, predates 09D, not seen in CI) | 09E PR 1 or a small separate fix |
| Password-reset first attempt stalled about 30 s on staging; instrument it | 09E-02 |
| 4 pgTAP files select or delete across all clinics and fail on a reused local DB (pass on a fresh DB, which CI uses) | Not assigned |
| Retire the Sydney Supabase project after a few days (staging moved to Mumbai on 2026-11-23) | PO (09D-P8) |
