# 06-09b record: re-verification fixes (N-1, N-2, N-7) and two CI items

Plan: the "Re-verification outcome" table in `06-09a-REVIEW-TRIAGE.md` (details: `reviews/v206a-review-reverify.md`,
checked at `4a4c796`), plus two coordinator items from CI run 43616771232 at `4a4c796` (the `/sw.js` guard-manifest entry
and the Linux-WebKit smoke failures). Branch `v2/phase-06-design-system-pwa-shell`, worktree shared with the 06-02a
executor (only 06-09b paths were staged). Application and tests only, no migration. Every number below comes from a
tool output in `evidence/06-09b/` (file named per row) or the command named in the row.

## Commits

| Commit | Item |
|---|---|
| `9ebbc51` | CI item 1: `app/sw.js/route.ts#GET` in the guard manifest (new `public-asset` kind) |
| `2b06a50` | N-2: `hardSignOut` hides the page right after the cleanups; unit and e2e tests. Also N-1's e2e header assertion (receipt PDF through the server) |
| `1d6cf2e` | N-1: 5-minute view links everywhere; link holders re-sign; PDF route header pinned |
| `6c43964` | N-2 e2e: the held-open case runs with the worker blocked (WebKit sends worker-controlled fetches past `page.route`) |
| `7460a53` | CI item 2: smoke accepts Linux WebKit's `interactive-widget` message, exact text, WebKit only |
| this commit | N-7 (06-09a record corrected), this record, evidence, wave-note rows |

## Items → fix → test → fails without the fix

| ID | Fix | Test | Fails without the fix |
|---|---|---|---|
| **N-1** (Medium, partial now) | `lib/storage/view-link.ts`: `VIEW_LINK_TTL_SECONDS = 300`. Every `createSignedUrl` call site uses it: lab documents (`features/labs/service.ts`), referral letters (`features/referrals/service.ts`, `pdf/generator.ts`), prescription PDFs (`features/prescriptions/pdf/generator.ts`), receipt PDFs (`features/billing/pdf/generator.ts`): all 3600 s before; patient share links (`features/sharing/system.ts`, `/r/<token>` and `/reports/view`): 600 s before. The provider default (no lifetime given) is 300 s, was 3600 s. No call site keeps a longer link: none is a download that needs one (see "Link holders"). PDF routes (`/api/visits/[id]/prescription-pdf`, `/api/invoices/[id]/receipt-pdf`, and `/api/r/[token]?download` for a receipt) already answered `private, no-cache, no-store, must-revalidate`; now pinned by tests. | Lifetime read from the generated URL (JWT `exp - iat` of the `token` parameter, `tests/helpers/signed-url.ts`) on the local stack: `labs/lab-documents` (`getDocumentSignedUrl`), `referrals/referrals-flow` (create + `getReferralSignedUrl`), `integration/prescription-versioning` (generator + both letterhead modes), `integration/receipt-reports` (generator + action). The call: `security/share-path-encoding` (share signer → `createSignedUrl(path, 300, …)`), `storage/storage-provider` (provider default 300; reuse rule). Header on the route: `security/pdf-route-guards` (served prescription and receipt PDFs, inline and download: `private` and `no-store`); through the real server: `e2e/pwa/05-cache-audit` (receipt PDF fetch). | `n1-ttl-without-change.txt`: with the seven source files at their pre-06-09b state, 9 tests fail (every lifetime and call assertion above). `n1-header-mutation.txt`: with the two PDF routes answering `no-cache` only, the route test fails ("expected [ 'no-cache' ] to deeply equal ArrayContaining ["private", "no-store"]"). |
| **N-2** (Low) | `lib/auth/hard-sign-out.ts`: `conceal()` (hide + `inert`) runs right after `runCleanups`, before the broadcast and `POST /auth/signout`, for every reason except `recovery`; the final `conceal()` stays as the backstop. | `tests/pwa/hard-sign-out.spec.ts`: call order now `cleanups, conceal, announce, fetch, …, conceal, purge, replace`; new: the page is hidden while the server call is still open; hanging cleanups delay the hiding by their 2 s budget at most. `tests/e2e/pwa/05-cache-audit.spec.ts` (`@golden`, worker blocked): `/auth/signout` held open with `page.route`; while held, the tab is still on the patient URL, `<html>` is `visibility:hidden` and `inert`, the patient name is not visible, a page control takes no focus; then `/login`, no auth cookie. | `n2-unit-without-change.txt`: 6 unit tests fail on the old `run()`. `n2-e2e-without-change.log`: with the old `hard-sign-out.ts` built (`e2e:build`), the e2e fails on desktop-chrome, pixel-7 and iphone-15 ("Expected: hidden, Received: visible"). |
| **N-7** (Info) | `06-09a-REVIEW-FIXES.md`: keyspace 8 × 18 = **144** (`CLIENT_KEYSPACE`; `/` is one of the 18 generated patterns), with a correction note; was "8 × 19 = 152" in two places. | `npx tsx -e` import of `lib/observability/client-render-event.ts` prints `CLIENT_KEYSPACE 144`. | n/a (record only) |
| **CI 1** `/sw.js` guard entry | `tests/security/guard-manifest.ts`: new `RouteGuard` kind `public-asset` (`{ contentType }`), `app/sw.js/route.ts#GET` listed as `application/javascript`. Leg (`tests/security/guard/engine.ts` `publicAssetRouteLeg`): anonymous GET 200 with the declared content type, no request-client data access, no `Set-Cookie`, no ids or tenant B values; a signed-in owner gets the byte-identical body. None of the existing kinds fit (public-health requires a JSON body). | `guard-routes` + `guard-canary`: 63/63 (`guard.log`; `public-asset: app/sw.js/route.ts#GET` ran). | Before: both specs fail on the missing entry (CI run 43616771232; 06-02a's `evidence/06-02a/vitest.txt`). A wrong content type in the entry fails the leg (checked by hand, output in the session, not kept). |
| **CI 2** Linux WebKit smoke | Kept `interactiveWidget: "resizes-content"` (`app/layout.tsx`): on Chrome Android (default `resizes-visual` since 108) it is what makes the keyboard shrink the layout viewport, so the `h-app`/`min-h-app` (100dvh) shell and its sticky bottom actions stay above the keyboard (PWA_STRATEGY §3.3 "Keyboard", 06-05 record). `tests/e2e/smoke.spec.ts` accepts exactly `Viewport argument key "interactive-widget" not recognized and ignored.`, on WebKit only, with the reason in a comment; any other console error still fails. | Linux WebKit, iphone-15 project, through the official `mcr.microsoft.com/playwright:v1.63.0-noble` image (`run-server` with the repo's own `playwright-core` mounted read-only; `PW_TEST_CONNECT_EXPOSE_NETWORK=<loopback>`): smoke 5/5 (`linux-webkit-after.log`, tests 15–19). | `linux-webkit-smoke-before.log`: the previous smoke spec fails 5/5 on Linux WebKit with exactly CI's message. macOS WebKit never logged it (why local runs were green). |

### Link holders (N-1: nothing reuses an expired link)

- Opened at once after signing (no change needed): lab document view (`patient-lab-documents.tsx`), referral register,
  consultation workspace, the referral letter right after creation.
- Held for later use, now re-signed when older than 270 s (`isViewLinkFresh`, 30 s short of expiry): the referral notice
  on the patient page and the referral success modal ("Print"), the prescription preview modal's Download and its
  print-in-a-tab fallback.
- Held, now replaced by the same-origin route: the receipt modal's Download and print-in-a-tab fallback use
  `/api/invoices/<id>/receipt-pdf` (compiled per request, `private, no-store`). The patient report page's Download
  buttons use `/api/reports/view?token=…&download=true` (re-checks the token, signs a new link per click); `/r/<token>`
  already did this.
- The preview iframes load their link once, at render; an expired link does not affect a document already shown.

### What N-1 does not do (stays with V2-09c per the triage)

A PDF or storage tab opened from the app still runs no app code, so sign-out does not close it: what is on screen stays
until the tab is closed. 06-09b only shortens how long such a tab can be reloaded or its URL reused (5 minutes for a
storage link; never for a PDF route, which needs the session). The in-app document viewer under the dashboard is V2-09c.

## Suite results (at `7460a53`, after the last code commit)

| Check | Result |
|---|---|
| Static (`static-checks.txt`) | typecheck exit 0; `eslint .` 0 errors (24 warnings, pre-existing); inventory exit 0; ui-policy PASS (enforced rules 0 findings) |
| Vitest, targeted | `guard.log` 63/63; N-1 specs + `hard-sign-out` 116/116 (session output); `pdf-route-guards` 6/6 |
| Vitest, full (`vitest-full.txt`) | **5630 passed, 4 failed** (273 files). The 4 are exactly 06-02a's base failures minus the two guard specs this plan fixed (`evidence/06-02a/vitest.txt`: 6 failed at `20b5e94`): `billing/invoice-totals-db` (record_payment leg), `ci/hosted-dump-diff` ×2 (local stack ahead of the branch's migrations), `ops/drill-lib-db` `drill_authz_matrix`. None touches a 06-09b file; not fixed here |
| e2e (`e2e-final.log`, build `-dZ3Yj_Qe13fql1E1Jsro` of the committed source) | `05-cache-audit`, `06-tabs-and-devices`, `07-titles`, `auth/signout`, `smoke`, `security/unauth-pages` on desktop-chrome, pixel-7, iphone-15 (macOS WebKit), `--retries=0`: **106 passed, 0 failed, 7 skipped** (project filters), 0 flaky |
| e2e, Linux WebKit (`linux-webkit-after.log`) | smoke 5/5 on iphone-15. The 9 sign-out specs in the same run could not open a page at all in this remote harness (`page.goto: Could not connect to 127.0.0.1`, before any app code), so that run says nothing about them on Linux; CI's PR lane is their Linux evidence |
| gitleaks (`gitleaks.txt`) | run after this record is committed, over every commit since the 06-09b base `5b5481e` (partners' included); result in that file (separate commit) |

## Deviations

1. **Two coordinator items added mid-plan** (CI 1, CI 2 above), as instructed.
2. **N-1 went beyond the TTL value** where a shorter link would have broken a working path (Rule 1): the four link
   holders listed above. The patient share links (10 minutes before) are included, as the scope says "every signed URL
   used to view patient documents".
3. **The N-2 e2e first ran with the service worker on** and could not hold the POST on WebKit (`e2e-run1.log`: the
   held-open case failed on iphone-15 only, "the POST /auth/signout reached the network" never true). Root cause is the
   known WebKit + worker routing limit (06-09a wave-note row); the case now blocks the worker (`6c43964`), as
   `06-tabs-and-devices` does. Not a retry: a test that could never pass on that project.
4. **e2e built three times** under the lane lock (owner file `06-09b executor`): the fix, the pre-fix `hard-sign-out.ts`
   for the red proof, and the fix again. The worktree's source equalled `HEAD` for the evidence build (`git diff --quiet
   HEAD -- lib/ features/ app/ components/`).
