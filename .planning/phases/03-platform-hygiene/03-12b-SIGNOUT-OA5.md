# 03-12b record: `POST /auth/signout` + OA-5 default-deny (AUTH-04b part, PWA D-5, OA-5, R-28)

**Outcome:** done locally. Roadmap acceptance 11 ("`POST /auth/signout` clears the session server-side and returns
`Clear-Site-Data: "cache"`") is proven on the built app (e2e) and against the local GoTrue (unit + guard legs). The
OA-5 carry-over (signed-out dashboard requests redirected before any page data load; no "Unauthenticated" server
errors) is proven by the e2e sweep reading the 03-09b error sink.
**Evidence:** `evidence/03-12b/` (tool output only).

## Commits

| SHA | Subject |
|---|---|
| `e24e86d` | feat: `app/auth/signout/route.ts`, `lib/auth/same-origin.ts`, form-based user menu, guard kind `signout` (manifest + engine + `guard-routes.spec.ts` leg), `tests/auth/signout-route.spec.ts` |
| `d6290da` | feat: `lib/auth/public-paths.ts`, `proxy.ts` default deny, `tests/auth/public-paths.spec.ts`, proxy unit cases (`proxy-session.spec.ts`, `request-id.spec.ts`), e2e `unauth-pages.spec.ts` (OA-5 sink proof + public paths) and `signout.spec.ts` |
| `4093ff8` | fix: user menu axe (links are the menuitems, separator role, role-text contrast); read `Clear-Site-Data` through `allHeaders()` |
| (next) | docs: this record, the evidence and the wave-note rows |

## What shipped

- **`POST /auth/signout`** (`app/auth/signout/route.ts`). POST is the only export, so Next answers GET (and every
  other method) 405 and a link, prefetch or image tag cannot sign anyone out. Same-origin check
  (`lib/auth/same-origin.ts`, T-03-13): a browser `Sec-Fetch-Site` other than `same-origin` → 403 whatever `Origin`
  says; otherwise `Origin` equal to the `NEXT_PUBLIC_APP_URL` origin, or `Sec-Fetch-Site: same-origin`, passes;
  `Origin: null` or no signal at all → 403. The check runs before any client exists. Form field `scope`: `local`
  (default, also when there is no form body) or `global`; anything else 400. Then `supabase.auth.signOut({ scope })`
  on the cookie client (`lib/supabase/server`): GoTrue revokes the session (`local`) or every session of the user
  (`global`), and supabase-js deletes the auth cookies through `setAll` (Next merges `cookies()` writes into the route
  response). When GoTrue cannot revoke (an error other than 401/403/404, or a throw), supabase-js keeps the local
  session, so the route deletes every `sb-*-auth-token` cookie itself and logs `auth.signout.failed` (error tag only).
  Answer: 303 `Location: /login`, `Clear-Site-Data: "cache"`, `Cache-Control: no-store`, empty body, also with no
  session (idempotent). Log lines carry the request id and a fixed reason only. `hardSignOut()` (IndexedDB/SW wipe)
  stays V2-06 (PWA-02).
- **User menu** (`components/layout/user-dropdown.tsx`). Two plain `<form method="post" action="/auth/signout">`
  items replace the client `signOut()` (its default scope was `global`: every device was signed out): "Sign out"
  (`scope=local`) and "Sign out of all devices" (`scope=global`). The forms stop the click from reaching the menu's
  close handler: closing unmounts the form before the browser submits it. Accessibility (Rule 1, found by the axe
  check): the trigger is a real `<button aria-haspopup="menu">` (it was a clickable `div`, unreachable by keyboard); the
  profile/clinic links are themselves the `menuitem`s (a button inside a link before); the divider is a `separator`,
  the forms and the header `role="none"`; the role text is `gray-600` (4.4:1 on the hover background before).
- **OA-5 default deny** (`proxy.ts`, `lib/auth/public-paths.ts`, R-28). After `getClaims()`, a request with no claims
  (or a `getClaims` throw), method GET/HEAD, for a path `pageNeedsSession` calls protected → 307
  `/login?next=<path + query>`, before any layout or page loader runs. The redirect carries the request id and whatever
  `setAll` wrote (a failed refresh deletes the stale auth cookies; those deletions and the no-store headers reach the
  browser). Public page prefixes, segment-matched: `/login`, `/forgot-password`, `/join`, `/r`, `/reports/view`,
  `/reschedule`, `/auth`. A path is public only when both the raw path and its normalised form (03-06's
  `normaliseRequestPath`: fully decoded, separators and dot segments resolved) are under a prefix, so
  `/r/..%2Fpatients` and `/patients/..%2F..%2Flogin` stay protected; an undecodable path is protected. `/api/**` (raw
  and normalised) and Next internals (`/_next/`, `/__nextjs*`, raw and normalised) pass through. Everything else,
  `/clinic/new` included, is protected, so a new page defaults to protected. `next` drops Next's `_rsc` parameter and
  is omitted for anything that is not a plain single-slash path (`//host`, backslashes), so the redirect never
  carries an off-site target; the login page validates it again (03-12c `safeNextPath`, T-03-04).
- **Guard kind `signout`** (`tests/security/guard-manifest.ts`, `tests/security/guard/engine.ts`
  `signoutRouteLegs` + `signOutSpy`, `callRoute` form bodies and response headers; leg in `guard-routes.spec.ts`).

## Tests (each fails without the change)

- `tests/auth/public-paths.spec.ts` (61 cases): enumerates every `page.tsx` and `route.ts` under `app/`; every
  dashboard and onboarding page protected; exactly the six (auth)/share/reschedule pages public; every `/api` route
  passed through; the only route handler outside `/api` is `/auth/signout` (public); every public prefix matches an
  existing file (no stale entry); unknown paths default to protected; whole-segment matching; 13 encoded/dot-segment
  bypass shapes stay protected; `loginNextValue` keeps path + query, drops `_rsc`, refuses `//host` and `/\host`.
  Fails without the change: the module does not exist.
- `tests/auth/signout-route.spec.ts` (20 cases, local GoTrue): exports POST only (Next 405 for GET); five cross-origin
  shapes → 403 with no client created and the session still valid; unknown scope → 400; no session → 303 `/login`,
  `Clear-Site-Data: "cache"`, empty body; `local` (no form body, `Sec-Fetch-Site` only): the old refresh token →
  `refresh_token_not_found`, the old access token fails `getUser`, a second session of the same user still refreshes
  and still passes `getUser`; `global`: both sessions' refresh tokens and access tokens fail; GoTrue failure → 303 and
  exactly the three `sb-*-auth-token*` cookies deleted; 14 `isSameOriginRequest` cases.
- Guard leg `signout: app/auth/signout/route.ts#POST`: 9 refusal shapes (cross-origin, cross-site, same-site, `none`,
  `Origin: null`, no signal, other port, app origin with `cross-site`, bad scope) → 403/400, empty body, no data
  access, no `auth.signOut` call, the throwaway user's session still works; signed out → 303 `/login` with
  `Clear-Site-Data`. Mutation: making `isSameOriginRequest` return true fails the leg (run below).
- Proxy unit cases: `tests/api/proxy-session.spec.ts` (signed-out GET/HEAD `/patients/abc?tab=visits` → 307,
  `next=/patients/abc?tab=visits`, request id, no cookie; `/api` and a Server Action POST pass; an unrefreshable
  session → 307 that deletes the stale auth cookie; the old "signed-out passes through" case now uses `/login`);
  `tests/observability/request-id.spec.ts` (mock now returns claims unless `signedIn = false`; new case: the redirect
  carries a fresh id and the `setAll` cookie + no-store header).
- e2e `tests/e2e/security/unauth-pages.spec.ts` (desktop-chrome, pixel-7): every enumerated dashboard route's raw
  response (`maxRedirects: 0`) is 307 to `/login?next=<route url>` with an `x-request-id`; the followed page ends on
  `/login` with that `next`; no tenant marker in either; `ops.error_events` has 0 rows for the raw and document
  request ids of each route; a closing test asserts 0 rows for all sweep ids and 0 "Unauthenticated" rows written or
  bumped since the sweep began (workers = 1). Before the change: the raw 307 came from the layout with a bare
  `/login`, and the sink held "Unauthenticated" rows for `/patients`, `/profile`, `/referrals`, `/settings/clinic`,
  `/staff`, `/visits` from the earlier e2e runs today (`evidence/03-12b/sink-before.txt`). A last test proves the public
  paths stay reachable signed out: `/login`, `/forgot-password`, `/join` 200; `/r/<t>`, `/reports/view?token=<t>`,
  `/reschedule/<t>` 200/404; `POST /auth/signout` 303; `/api/health` 200, `/api/ready`, `POST /api/auth/send-email`
  401 (03-11b handoff), messaging webhook 401, both cron routes 401, `/api/v1/*` (off → 404), the share-token APIs
  404, `/api/patients/<id>/export` 401; none redirected to `/login`, all with a request id.
- e2e `tests/e2e/auth/signout.spec.ts` (desktop-chrome, pixel-7): fresh member on two contexts; "Sign out" → the POST
  response is 303 with `Clear-Site-Data: "cache"` and `scope=local`; no auth cookie left; old refresh token
  `refresh_token_not_found` at GoTrue; old access token fails `getUser`; the old cookie replayed in a new context lands
  on `/login`; the other device still opens `/patients`. "Sign out of all devices" (`scope=global`): the other
  device's refresh token is revoked and it lands on `/login`. GET 405; cross-origin POST 403 without
  `Clear-Site-Data`, session intact. User menu at 360/820/1280 px (desktop-chrome, nurse session, menu opened only):
  both items visible and in the viewport, axe 0 serious/critical on the menu and its trigger, no horizontal scroll at
  360 px.

## Deviations and interpretations (for review D, auth)

1. **Redirect only GET/HEAD.** The plan says "no claims + a non-public page path → 307". A POST to a page path is a
   Server Action call; redirecting it would make the browser re-POST the action to `/login` (307 keeps the method)
   and Next's action client would get an HTML page. Actions authenticate themselves (P0-13 guard manifest), so they
   pass through. Residual: a signed-out action POST still re-renders the page tree after the action fails, which can
   throw "Unauthenticated" into the sink; it needs a signed-in session to expire between page load and submit.
2. **`/auth` public prefix** comes from the plan's list; it matches `app/auth/signout/route.ts`, so the "no stale
   prefix" check counts route files as well as pages.
3. **Raw and normalised both public** (Rule 2): matching only the normalised path would let
   `/patients/..%2F..%2Flogin` (raw path routes to `/patients/[id]`) skip the redirect; only the raw path would let
   encoded separators through. The `/api` and Next-internal pass-throughs use the same both-forms rule.
4. **`next` sanitised at the source** (Rule 2, T-03-04 defence in depth): `_rsc` dropped, `//host` and backslash
   shapes omitted. The login page's use of `next` is 03-12c's (`lib/auth/safe-next.ts`); this plan does not import it
   (it was not committed when 03-12b ran) and does not touch the login page.
5. **New file `lib/auth/same-origin.ts`** (not in the file list): a Next route file may export only route fields, and
   the check has its own unit cases.
6. **Cookie deletion when GoTrue cannot revoke** (Rule 2): supabase-js keeps the local session on a 5xx/network
   error; the route deletes the `sb-*-auth-token*` cookies so this device is signed out anyway. The server-side
   session then stays valid until it expires; the failure is logged (`auth.signout.failed`).
7. **User-menu accessibility fixes** (Rule 1, found by the plan's axe check, all inside `user-dropdown.tsx`): trigger
   button, link menuitems, separator, contrast. `components/ui/dropdown.tsx` is unchanged: it still has no focus
   management, `aria-expanded` or Escape handling (V2-06 design-system work).
8. **Edited specs outside the file list**: `tests/api/proxy-session.spec.ts` and `tests/observability/request-id.spec.ts`
   asserted that a signed-out page request passes through, which R-28 reverses; both now cover the redirect.
   `tests/security/guard-routes.spec.ts` runs the new guard kind.

## Residual risks (not fixed here)

- **Image-extension paths skip the proxy.** The matcher excludes `*.svg|png|jpg|jpeg|gif|webp` outside `/api`
  (tested by `api-v1-switch.spec.ts`: "static assets outside /api stay excluded"), so `/patients/x.png` reaches the
  `/patients/[id]` page without the proxy. The dashboard layout still redirects (no data rendered), but page loaders
  can throw "Unauthenticated". There is no `public/` directory today; narrowing the matcher is a 03-06/AR2-H2 matcher
  decision for the phase review.
- **Asymmetric JWT keys (staging/production).** `getClaims()` verifies an ES256/RS256 token locally, so a revoked
  session's access token still passes the proxy (and PostgREST) until it expires (`jwt_expiry` 900 s, 03-11a). The
  sign-out deletes the cookies, the layout's `getUser()` round trip refuses it, and the refresh token is dead. Locally
  (HS256) `getClaims()` falls back to `getUser`, which refuses it at once. Add to the AUTH-00 hosted re-check (03-12c
  kit): after sign-out, the old access token is refused by `/auth/v1/user`.

## Evidence (tool output, `evidence/03-12b/`)

| Check | Result | File |
|---|---|---|
| typecheck, eslint, inventory, `.env.example --check` at `4093ff8` (clean detached worktree of the commit, so 03-12c's uncommitted files are not in it) | exit 0; eslint 0 errors, 422 warnings (baseline), 0 findings in 03-12b files | `static-checks.txt` |
| Full Vitest lane at `b0a0ac4` (tree also held 03-12c's uncommitted files) | 146 files, 2836 passed, 0 failed, 0 skipped; report gate PASS | `vitest-full-tail.txt`, `vitest-full.json`, `vitest-report-gate.txt` |
| Unit mutation run at `b0a0ac4`: redirect disabled → 3 proxy cases fail; origin check disabled → the guard leg, the route's cross-origin case and 10 `isSameOriginRequest` cases fail; files restored | as stated | `mutation-run.txt` |
| e2e OA-5 mutation run: app built with the redirect disabled (proxy restored right after the build), unauth sweep on desktop-chrome | 18 failed: every route's redirect shape, and the error-sink check on `/patients`, `/profile`, `/referrals`, `/settings/clinic`, `/staff`, `/visits` (rows bumped by the run listed) | `oa5-mutation-e2e.txt` |
| Sink state before the change (rows from today's earlier e2e runs) | "Unauthenticated" rows for six dashboard routes | `sink-before.txt` |
| `npm run e2e:build && npm run e2e:pr` at `b0a0ac4` (tree also held 03-12c's uncommitted files, listed in the summary) | 181 passed (10 of them known-bug expected failures), 0 unexpected, **0 flaky / retried**, 7 skipped on pixel-7 by design (error-sink 2, send-email hook 2, the 03-12b menu axe check 3) | `playwright-results.json`, `playwright-summary.txt` |
| User menu screenshots at 360/820/1280 px (desktop-chrome) inspected: both items visible, menu inside the viewport, no overlap | inspected, not committed (test output dir) | — |
| gitleaks v8.30.1, full history | no leaks found | `gitleaks.txt` |

`commit.txt` holds the SHA the e2e and Vitest runs used.
