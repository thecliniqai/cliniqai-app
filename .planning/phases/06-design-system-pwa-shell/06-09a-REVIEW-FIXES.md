# 06-09a record: Wave A review fixes (pass 1)

Plan: `06-09a-REVIEW-TRIAGE.md` (scope: H-WEBKIT, M-EVERYWHERE, M-TABS, M-ERRCAP, M-OFFLINE, M-GUARD and the cheap
Lows). Reviews: `reviews/v206a-review-{independent,adversarial-pwa,adversarial-client-errors}.md` (reviewed commit
`ef24000`). Branch `v2/phase-06-design-system-pwa-shell`, worktree shared with the 06-01b and 06-02a executors (their
commits interleave with these; only 06-09a paths were staged). Application only, no migration. Every number below
comes from a tool output in `evidence/06-09a/` (file named per row) or the command named in the row.

## Commits

| Commit | Findings |
|---|---|
| `5cde926` | M-OFFLINE (build-stamped `/sw.js` route, per-build shell cache, self-contained `/offline`, `npm run e2e:sw-update`); spec 5 exit paths tagged `@golden` (H-WEBKIT); PWA runbook |
| `1777942` | H-WEBKIT, M-EVERYWHERE, M-TABS, A L-3, IND L-1, A L-2, IND L-6 + A Info I-1 |
| `a79297c` | M-GUARD, A L-1 |
| `fdf4f76` | M-ERRCAP (IND M-2, C M-1, C M-2), C L-1, C L-2, C Info I-3 (06-04a addendum), C Info I-4 (error-sink runbook) |
| `c0a5a83` | IND L-2, IND L-4, IND L-5, C L-3 |
| `97afcc6` | comment in `tests/e2e/auth/signout.spec.ts` (the fetch now has a normal answer) |
| `f09705d` | iPhone-15 sign-out specs on the shared lane (coordinator, from 06-01b's attribution): root cause and harness fix; `hardSignOut` hides the page before the purge |
| `41517f2` | `client-error.spec.ts` waits out the C L-1 repeat window opened by other specs on the shared e2e server |
| `2a567df` | `client-routes.spec.ts` fixture path renamed (the doc-grep gate read `docs/[...slug]` as a docs path) |

## Findings → fix → test → fails without → reviewer reproduction

| ID | Fix | Test | Fails without the fix | Reviewer reproduction, re-run |
|---|---|---|---|---|
| **H-WEBKIT** (A H-1; IND L-1, A L-2) | Root cause isolated first: WebKit never settles a `redirect: "manual"` fetch whose answer is a 303 carrying `Clear-Site-Data`; a 303 without it, or a 200/204 with it, settles (`webkit-signout-answer-probe.txt`, standalone loopback server, WebKit and Chromium). The route answers `hardSignOut` (header `x-clinicos-signout: fetch`) with JSON: 200 `{ scope, revoked: true }` / 502 `{ scope, revoked: false }`, `Clear-Site-Data` kept; form posts keep the 303. `hardSignOut`: every await raced against a plain `setTimeout` (no `AbortSignal.timeout`; an `AbortController` aborts a timed-out fetch when available), one 8 s deadline for cleanups + announce + server + fallback, then (always, `finally`) hide the page, purge (3 s cap), `location.replace`. | `tests/pwa/hard-sign-out.spec.ts` (fetch that never settles with `AbortSignal.timeout` removed; every step stuck at once; purge that never settles; answer parsing); `tests/auth/signout-route.spec.ts` (fetch caller 200 JSON + Clear-Site-Data, no Location); spec 5 exit paths + `06-tabs-and-devices.spec.ts` run on `iphone-15` (`@golden`): 17/17 iphone-15 tests pass in both PR-lane runs, 0 retries (`e2e-pr-run1.json`, `e2e-pr-run2.json`) | `hard-sign-out-hang-before-after.txt`: the same never-settling fetch, real timers: `0892105`'s `hardSignOut` has not navigated after 7 s (`expected [] to include 'replace /login'`); 06-09a's has run local sign-out, cookie expiry, purge and `replace /login` | `adv-pwa-rerun.txt`: `back-webkit` now signs out through the menu on WebKit and lands on `/login` (before: stuck on `/profile` showing "Signing out…", `adv-pwa-run4.log`). The reviewer's raw `diag3` primitive still hangs because it posts without the fetch header (the form contract is unchanged on purpose: a form post is a navigation, which settles) |
| **M-EVERYWHERE** (IND M-1, A M-1) | Route: a failed GoTrue revocation answers a fetch caller 502 `{ revoked: false }` and a form post `303 /login?signout=partial`. Client: when the route fails, "everywhere" tries the browser client's `auth.signOut({ scope: "global" })`; if nothing revoked every session, this device is still signed out (cookies expired) and the target is `/login?signout=partial`, where the login page shows the fixed `PARTIAL_SIGN_OUT_NOTICE` (retry = sign in and choose the item again). | unit: 6 cases in `hard-sign-out.spec.ts` (revoked, 502, route down + client global ok, both down, all timed out, local 502 not reported); `signout-route.spec.ts` (502 JSON for both scopes with cookies deleted; form global failure → `?signout=partial`, local → `/login`); e2e `06-tabs-and-devices.spec.ts`: route unreachable + GoTrue reachable → device 2 signed out, no notice; both unreachable → notice shown, this device has no auth cookie, device 2 still signed in (the notice is the truth). Desktop, Pixel 7 and iPhone 15 | The route at `0892105` answers 303 `/login` whatever GoTrue said and `hardSignOut` falls back to `scope: "local"` (the new route and client cases assert 502/`partial`/`signOutLocally global`, which that code cannot produce) | `adv-pwa-rerun.txt` `everywhere-fallback`: device 2 now ends on `/login` (signed out; before `/patients`, `adv-pwa-run1.log`). In that probe GoTrue is reachable, so the client's global sign-out succeeds and no notice is due |
| **M-TABS** (A M-2) | `lib/pwa/auth-broadcast.ts`: `announceSignOut()` posts on `BroadcastChannel("clinicos-auth")` (random per-page value so a page ignores its own echo) and writes+removes a `localStorage` key (storage-event fallback; the key never stays). `PwaRuntime` listens: hides and inerts the page at once, runs cleanups and the purge, `location.replace("/login")`; no server call, so the tab never acts under new cookies. | `tests/pwa/auth-broadcast.spec.ts` (Node `BroadcastChannel`, storage fallback alone, own echo ignored, unrelated messages, stop); `hard-sign-out.spec.ts` (follow: no server call, leaves even with a hung purge); e2e `06-tabs-and-devices.spec.ts` M-TABS: the second tab is on `/login` within 2 s with the patient gone (all three projects) | No signal existed at `0892105` (new module); the reviewer's probe below is the before | `adv-pwa-rerun.txt` `multi-tab`: `tab2Url /login`, `patientNameStillVisible: false` (before: patient URL and name after 17 s, `adv-pwa-run1.log`) |
| **M-ERRCAP** (IND M-2, C M-1, C M-2) | Names kept only from `CLIENT_ERROR_NAMES` (8 classes), else `client.Error`; routes kept only from `lib/observability/client-routes.ts` (the dashboard's 18 page patterns, generated from `app/(dashboard)/` by `scripts/observability/client-routes.mjs`), else `/`. Keyspace 8 × 19 = 152 fingerprints a day for all instances together (≤ 40 % of the 500 cap, asserted). No migration; R-3 stands (no tenant/user on client rows). | `client-render-event.spec.ts` (lists, the reviewer's PHI-shaped strings, 10 instance lifetimes → one fingerprint, keyspace bound); `client-routes.spec.ts` (list equals the route tree; generator rules; `--check`); `client-error-action-db.spec.ts` (PHI-shaped name/route reach neither the row nor the log) | `client-errors-reviewer-repro.txt`: on `0892105` the probes store `client.Ravi_Kumar_ph_98765-43210` at `/patients/[Ravi_Kumar_98765_43210]` and reach **500** distinct fingerprints | Same file, after: every probe stores `client.Error` at `/`; **1** fingerprint |
| **M-OFFLINE** (IND M-3) | `/sw.js` is `app/sw.js/route.ts` (dynamic, own `no-store` + CSP headers) serving `lib/pwa/service-worker-source.ts` with `buildStamp()` (`CLINICOS_BUILD_STAMP`, computed once per `next build` in `next.config.ts` `env` from `VERCEL_DEPLOYMENT_ID` or a random UUID; the compiled server returns it as a literal, so it is fixed per build). Shell cache `shell-<stamp>`; `activate` deletes every other. `/offline` is precached with the same-origin stylesheets it links and without its scripts (`data-sw-build` on `<html>`); those stylesheets are answered from the shell cache (never FIFO-evicted). `public/sw.js` removed; kill switch now replaces the route (runbook). | `sw-allowlist.spec.ts` (+6 cases: two stamps two scripts, invalid stamps refused, stylesheet precache, scripts removed, offline CSS from the shell cache, refused CSS fails install, second build's worker replaces the first's shell); `purge.spec.ts`; e2e spec 3 (stamp = cache name, stylesheet precached, no script); **`npm run e2e:sw-update`**: two real builds, one persistent Chromium profile: build A's worker serves A's `/offline` offline, styled (`display:flex`, accent button), no script; after build B the update check installs B, A's shell cache is gone, B's `/offline` is served styled (`sw-update.txt`: 1 passed) | At `0892105` `/sw.js` is the static `public/sw.js`: byte-identical across builds, so the update check finds nothing (the sw-update spec's first assertion, a build stamp in `/sw.js`, cannot hold) and the CSS is only in the FIFO static cache | IND reproduced by reading `.next/server/app/offline.html`; the sw-update spec is that reproduction run in a browser |
| **M-GUARD** (IND M-4, A L-1) | Exempt files by explicit name only: `lib/auth/hard-sign-out.ts`, `app/auth/signout/route.ts`, `features/auth/service.ts` (only while it has `import "server-only"`). New findings: any string expression that folds to `signOut` (template, concatenation, a string kept in a variable, `Reflect.get(…, "signOut")`), an unknown computed key or `Reflect.get` on `auth`, any `/auth/v1/logout` URL. `features/auth/password-flows.ts` `abandonReset()` signs out through `hardSignOut("recovery")` (no navigation). | `ui-policy-signout-guard.spec.ts`: 15 fixture findings (9 new), allowed list, server-only requirement, repository 0 | `signout-guard-before-after.txt`: 06-05's rule reports 6 of the 15 fixtures and 0 for `0892105`'s `password-flows.ts`; 06-09a's reports all 15 and `password-flows.ts:221` | IND's run of `ui-policy.mjs` (0 findings while `password-flows.ts:221` signed out in the browser) is the "before" row above |

### Lows

| ID | Fix | Test |
|---|---|---|
| A L-3 | An "everywhere" call during a weaker run sets the run to global if the server call has not gone out, otherwise the run ends on the partial notice | 2 cases in `hard-sign-out.spec.ts` |
| IND L-1, A L-2 | Part of H-WEBKIT (no `AbortSignal.timeout`; overall deadline; purge capped) | H-WEBKIT rows |
| IND L-2 | `/profile`, `/referrals`, `/billing/reports`, `/settings/developer` drop their own brand suffix | `tests/e2e/pwa/07-titles.spec.ts` (title = "<words> · CliniQ AI", brand once) |
| IND L-4 | The banner time is the last successful data response (Resource Timing: document + fetches with a response), not module state only listeners updated | `tests/pwa/online.spec.ts` |
| IND L-5 | `serverEnv()` guarded in the dashboard layout (`swEnabled` false on a refused env) | by reading (one `try`); covered by the PR lane loading every dashboard page |
| IND L-6 + A Info I-1 | `/login` purges and signals other tabs when reached with no session cookie (proxy revocation, reset sign-out); a sign-in over a live session signals and purges (`lib/pwa/session-arrival.ts`) | `auth-broadcast.spec.ts` (4 cases); e2e IND L-6 case (cookies cleared, no `hardSignOut`: storage and rogue cache purged on arrival, other tab leaves within 2 s) |
| C L-1 | A key repeated within 60 s on the same instance is dropped: no log line, no write | `client-render-event.spec.ts`, `client-error-action-db.spec.ts`; `client-error.spec.ts` e2e (second throw: count stays 1) |
| C L-2 | The first refusal by the 50-key instance cap writes one `observability.sink.client_cap_reached` line | `client-error-action-db.spec.ts` |
| C L-3 | `lhci` output is redacted before it is thrown, logged or attached (`redactToolOutput`, `lhciFailureMessage`) | `tests/ci/lhci-config.spec.ts` (2 cases) |
| C Info I-3, I-4 | 06-04a record addendum (deviation 5 stands; deviation 6 replaced); `docs/runbooks/error-sink.md` describes client rows | docs |
| C Info I-2 (cookie-decoded tokens) | Not a one-line change (chunked `base64-` cookies must be joined before decoding) → V2-14 per the triage | — |

## The iPhone-15 sign-out failures on the shared lane (coordinator request)

06-01b's PR lane at `a79297c` had 5 iphone-15 failures in the new `@golden` sign-out specs
(`evidence/06-01b/e2e-attribution.txt`). Root cause (`webkit-sw-routing-probe.txt`, three instrumented runs):

1. **On WebKit, a page the service worker controls sends its subresource requests past `context.route`/`page.route`.**
   The first `/login` of each test (worker not yet registered) has its Turnstile script routed to the local stub; the
   `/login` reached after `hardSignOut` is worker-controlled, its script request is seen by `context.on("request")`
   but never by the route, so the real Cloudflare script loaded and fetched `/turnstile/v0/b/<build>/api.js` and the
   challenge frame (the frame was routed and aborted, hence both fixture failures). This is a harness gap, not an app
   defect, but it let a request from the e2e browser reach Cloudflare (a script fetch; synthetic data only). Fix:
   every PWA context gets a proxy nothing listens on, with loopback bypassed (`DEAD_PROXY` in
   `tests/e2e/pwa/fixtures.ts`), so a request the route never saw fails on the machine; after it, no `/b/` script and
   no challenge frame appear. The two M-EVERYWHERE cases, which need `page.route` to abort the app's own calls, run
   with the worker off (it bypassed the abort on WebKit, so case 2 timed out waiting for the partial notice).
2. **WebKit reports the 307 `/patients` response without its headers** (`x-request-id` null in the probe), so
   `expectSignedOut`'s "request carried a request id" could never hold there. It now requires the 307 to be seen and
   checks `request.error` lines for the `/patients` route (plus any ids the browser does expose).
3. **Playwright's WebKit cannot navigate while emulating offline under a service worker**: `page.goto` and
   `location.replace` alike end in "WebKit encountered an internal error", with navigation preload on or off. The
   offline sign-out case therefore asserts the `/offline` landing on Chromium; on WebKit it asserts the sign-out
   finished (no auth cookie, purge done) and the page is hidden. Product hardening from this: `hardSignOut` now hides
   and inerts the page before the purge, so a navigation a browser refuses never leaves patient data on screen.

Result: iphone-15 17/17 passed in both full PR-lane runs, 0 retries.

## Suite results (local)

| Lane | Result |
|---|---|
| `npm run typecheck` | pass (`static-checks.txt`) |
| `npx eslint .` | 0 errors, 461 warnings (none new in 06-09a files) |
| `npm run inventory` | exit 0, 0 flagged |
| `npm run ci:ui-policy` | PASS; `signout-guard` [enforce] 0 |
| `npm run ci:ai-l1` | PASS |
| Vitest, targeted (DB lane, shared stack) | `vitest-targeted.txt`: 26 files, 1243 tests pass (sign-out route, client-error action, guard actions, observability, PWA, guard and LHCI specs, public paths); final run (`tests/auth tests/observability tests/pwa tests/ci tests/errors` + guard actions, after `41517f2`): 2050 / 2053; the doc-grep gate case (06-09a's fixture path, fixed in `2a567df`, re-run green) and the two `hosted-dump-diff` cases the 06-05 record lists as failing on this shared stack (`vitest-targeted-final.txt`) |
| `npm run e2e:pr` run 1 (`f09705d` build) | 319 passed, 2 failed, 56 skipped, 0 flaky, 0 retried (`e2e-pr-run1.json`). Failures: `client-error.spec.ts` (06-09a's own: the C L-1 debounce dropped this spec's report because the route-state specs had reported the same key on the shared server less than a minute before; fixed in `41517f2`) and `a11y/v2-01-screens.spec.ts` "change-password form at 1280px" (axe color-contrast on `.text-body-sm`; not a 06-09a file or class; passed in run 2 with no retry: handed to the orchestrator, see Open) |
| `npm run e2e:pr` run 2 (tests at `41517f2`) | **321 passed, 0 failed, 56 skipped, 0 flaky, 0 retried**; iphone-15 17/17 (`e2e-pr-run2.json`) |
| `npm run e2e:sw-update` | 1 passed (`sw-update.txt`) |
| Review A's probe specs re-run | 16 passed; results in `adv-pwa-rerun.txt` |
| gitleaks (`ghcr.io/gitleaks/gitleaks:v8.30.1`, commits `763673f..HEAD` of a local clone) | no leaks found (`gitleaks.txt`) |

All e2e runs used a private detached worktree (cloned `node_modules`), under the shared lane lock with an owner file.
The local stack was not reset or stopped.

## Deviations

1. **`/sw.js` is a route handler, not `public/sw.js`.** A build stamp in the bytes needs generation; a route that renders
   the worker from a TS string with the inlined stamp needs no build step and keeps one source. Consequences: the kill
   switch replaces the route (`git rm -r app/sw.js` + copy the kill-switch file to `public/sw.js`), and
   `tests/auth/public-paths.spec.ts` now lists `/sw.js` among the non-API route handlers.
2. **`/offline` is self-contained by precaching its stylesheet, not by inlining CSS.** `app/offline/page.tsx` is
   06-01b's branded page; inlining would fork its styling. The shell's five URLs stay within PWA §3.9's 150 kB; the
   stylesheet (the app's single CSS file, about 150 kB stored) is reported separately by spec 3 — **PO to confirm**
   (PWA §3.9 says "offline page + icons only"). Fonts are not precached: offline the page draws in the metric fallback.
3. **Client error fallbacks are per field** (unlisted name → `client.Error`, unlisted route → `/`), not one key for
   both: the key space is still bounded (152) and an honest unknown class on a real route keeps its route.
4. **`count` on client rows now means "reports at least a minute apart"** (C L-1 debounce); the 06-04a e2e and
   runbook say so.
5. **New sign-out reason `recovery`** (the forgot-password page ends its recovery session through `hardSignOut`
   without navigating), so `password-flows.ts` no longer calls `auth.signOut`.
6. **Harness:** PWA contexts use a dead proxy (loopback bypassed); M-EVERYWHERE e2e cases run with the worker off;
   `expectSignedOut` no longer needs the 307's headers; the offline sign-out's `/offline` landing is asserted on
   Chromium only (Playwright WebKit cannot navigate offline under a worker).

## Open (owner)

- `a11y/v2-01-screens.spec.ts` "change-password form at 1280px" failed once (axe color-contrast, `.text-body-sm`) and
  passed in the next run without retry: intermittent, not touched by 06-09a (the 06-01b run at `a79297c` passed it;
  06-02a's `cn()` change `2746fb1` landed since). **Orchestrator / 06-02a** to root-cause.
- PO: precache size with the stylesheet (deviation 2).
- `npm run e2e:sw-update` is not in CI: **06-08** (nightly).
- Real-device check that iOS Safari lands on `/offline` after an offline sign-out (Playwright WebKit cannot show it):
  the PWA runbook's manual device check, **06-P device test**.
- A fresh re-verification review of the High (H-WEBKIT) per the triage ruling: **orchestrator**.
- C Info I-2 (decoded session tokens in the LHCI secret list): **V2-14**.
