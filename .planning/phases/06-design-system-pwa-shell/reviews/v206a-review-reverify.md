# V2-06 Wave A: adversarial re-verification of the 06-09a fixes

- Reviewer: isolated adversarial re-verifier (fresh context). I read `06-09a-REVIEW-FIXES.md` only after my own probes.
- Commit checked: `4a4c796` (`v2/phase-06-design-system-pwa-shell`), in a private detached worktree (`npm ci`, its own
  `.next`). The worktree has since been removed. No source edits to the branch, no commits.
- Lane: one `npm run e2e:build` (build `jtKAQOJ7O-IsPbtDoHvV1`, SW stamp a random UUID), then the probe specs,
  the PR-lane PWA/sign-out/client-error specs, review A's original probe specs, and `npm run e2e:sw-update` (two more
  builds). All of it ran under `e2e-lane.lock` (owner file `06-09a-reverify`), which I released afterwards. The local
  stack was not reset or stopped. All users were synthetic nurses from `freshMember()`, or the run's seeded roles.
- Logs and probe sources are in the session scratchpad, `rv-evidence/`: `rv-run1.log` (probes), `rv-run2.log`
  (follow-ups), `rv-run3.log` (raw-context WebKit), `rv-legit.log`, `rv-adv.log` (review A's specs re-run),
  `rv-swupdate.log`, `guard-bypass.txt`, `hard-sign-out-node-probe.txt`, `errcap-node-probe.txt`, `probes/`.

## Verdict per finding

| ID | Status | One line |
|---|---|---|
| H-WEBKIT | **CLOSED** | WebKit sign-out lands on `/login` in about 110–270 ms with the worker controlling, with and without request interception. A hang in any step is capped at about 11 s, after which the page is hidden and navigated away. |
| M-EVERYWHERE | **CLOSED** | Both reproductions now end truthfully: device 2 is signed out, or the user sees the partial notice. The fetch path cannot be triggered cross-site. |
| M-TABS | **PARTIAL** | App tabs leave within about 250 ms (BroadcastChannel; storage fallback on Chromium; also bfcache Back and a racing reload). Document tabs opened by the app (inline PDFs, signed storage URLs) are not reached: new finding **N-1** (Medium). |
| M-ERRCAP | **CLOSED** | Every free-text, unicode, long-input, prototype-key and pattern-variant input folds to `client.Error` / `/`. The keyspace is 144 for all instances together, under the 500 cap. The repeat debounce holds. |
| M-OFFLINE | **CLOSED** (Chromium) | Two real builds give two stamps; the device installs the new worker, the old shell cache is deleted, and the new `/offline` renders styled with no scripts. On WebKit this cannot be checked offline in Playwright (harness limit, as the fixes record says). |
| M-GUARD | **CLOSED** for the named spellings; residual **N-3** (Low) | The repository has 0 findings, and `password-flows.ts` goes through `hardSignOut("recovery")`. Deliberate obfuscation still passes (aliased `auth`, `.join`-built names or URLs). |

No new High. New Medium: N-1. New Lows: N-2, N-3. Info: N-4 to N-7.

---

## H-WEBKIT: CLOSED

**Original reproduction, re-run:**
- Review A's spec set, `rv-adv.log`: 16/16 passed.
- `back-webkit`: every Back step reaches `/login?next=…` with no PHI.
- `diag3-webkit`: no hang in any primitive. The app no longer uses the hanging `redirect:"manual"` + 303 + Clear-Site-Data combination.

**New routes tried:**

| Probe | Result |
|---|---|
| WebKit (iPhone 15), fixture context, worker **controlling** the patient page, menu Sign out (`rv-run1.log` `legit-webkit`) | `/login` in 270 ms. 0 auth cookies, 0 non-allowlisted cache entries, no session/local/IDB keys. |
| WebKit **raw context** (no `page.route`/`context.route`, dead proxy only; worker controlling) (`rv-run3.log`) | `/login` in 110 ms, 0 `sb-*` cookies. Chromium: 123 ms. |
| WebKit **offline** sign-out, worker controlling (`rv-run2.log` `offline-end-webkit`) | After 13 s the URL is still `/patients/<id>`, but `documentElement` is `visibility:hidden` and `inert`, cookies are 0, and nothing is visible. Playwright WebKit refuses every navigation while offline under a worker (`page.goto('/login')` also fails: "internal error"), which matches the fixes record. Chromium lands on `/login` showing the precached offline page in 0.6–1.1 s. |
| Node probe, every step hangs (cleanups, fetch, local signOut, purge) (`hard-sign-out-node-probe.txt`) | `replace("/login")` still runs at 11.0 s (8 s deadline + 3 s purge cap), after cookies are expired and the page is hidden. |
| Node: legacy 303/opaque answer, `{revoked:"true"}` string, 502 | Treated as failed or here-only: browser-client fallback, or the partial notice. Never a false success. |
| Node: "everywhere" escalation before / after the server call went out | Before: `scope=global` is sent. After: the run ends on `/login?signout=partial` (A L-3 holds). |

**Residuals (Info):**
- On a refused offline navigation, the patient DOM stays in memory, hidden and inert, until the next navigation. Nothing is visible or selectable.
- Real-device iOS confirmation stays with 06-P, as the fixes record says.
- See N-2: the tab doing the sign-out stays visible during the server call.

## M-EVERYWHERE: CLOSED

**Original reproduction, re-run** (`rv-adv.log` `everywhere-fallback`, `/auth/signout` aborted on device 1): device 1 lands on
`/login` and device 2 lands on `/login`. The browser client's global revocation worked, so a plain `/login` is the truth.
Spec 06's case with GoTrue unreachable as well (PR lane, all three projects, `rv-legit.log`): partial notice shown,
device 2 still signed in, as the notice says.

**Fetch path (`x-clinicos-signout: fetch`), `rv-run1.log`:**
- Refused with 403, empty body, nothing touched:
  - cross-site Sec-Fetch-Site + foreign Origin;
  - same-site;
  - no Origin and no Sec-Fetch-Site;
  - `Origin: null`.
- Same-origin with a bad scope: 400. GET: 405.
- `OPTIONS` preflight: 204 with **no** `Access-Control-Allow-*`, so a cross-origin page cannot send the custom header.
  In a browser, from `http://localhost:3100` (another origin) to `127.0.0.1:3100`: the CORS fetch is blocked, and the
  no-cors POST is opaque (the server refuses it as cross-site, and SameSite=Lax would keep the cookies off anyway).
- The JSON body is `{scope, revoked}` only, with `no-store` and `Clear-Site-Data: "cache"`. Nothing leaks.
- Info N-5: a same-origin call with **no session** answers `200 {revoked:true}`.

## M-TABS: PARTIAL

**Original reproduction, re-run** (`rv-adv.log` `multi-tab`): tab 2 is at `/login` and the patient name is gone.
PR-lane spec 06 passes on all three projects.

**New routes tried (`rv-run1.log`):**

| Probe | Chromium | WebKit |
|---|---|---|
| `BroadcastChannel` deleted in every tab (storage-event fallback only) | tab 2 at `/login` in 254 ms | tab 2 **stays** on the patient page. Harness limit: Playwright WebKit delivers **no** `storage` events between pages at all, even a plain `setItem` (`rv-run2.log` `storage-webkit`: `[]`). See N-6. |
| Tab 2 left the patient page (full document navigation), sign-out in tab 1, then tab 2 Back (bfcache) | `/login`, no PHI | `/login`, no PHI |
| Tab 2 reload in flight with valid cookies; its answer held until tab 1 had been on `/login` for 2.5 s | ends on `/login`, no PHI, 0 cookies | same |
| Document tab opened from the app | see N-1 | see N-1 |

### N-1 (Medium, new route to the M-TABS outcome): patient documents opened in their own tab stay on screen after sign-out; signed storage links stay usable for up to an hour

**Where:**
- `target="_blank"` / `window.open` to `/api/visits/<id>/prescription-pdf` and `/api/invoices/<id>/receipt-pdf` from:
  - `components/patients/patient-visit-history.tsx`
  - `components/visits/read-only-encounter-modal.tsx`
  - `components/visits/visits-register-view.tsx`
  - `components/queue/checkout-drawer.tsx`
- `window.open(signedUrl)` for lab documents and referrals from:
  - `components/patients/patient-lab-documents.tsx`
  - `components/patients/patient-detail-view.tsx`
  - `components/referrals/*`
  - `components/consultation/pdf-preview-modal.tsx`
- The signed URLs are created with `expiresInSeconds: 3600` in:
  - `features/labs/service.ts`
  - `features/referrals/service.ts`
  - `features/prescriptions/pdf/generator.ts`
  - `features/billing/pdf/generator.ts`

**Reproduction:**
1. Owner session: `GET /api/visits/<id>/prescription-pdf` answers `200 application/pdf`, `Content-Disposition: inline` (`rv-run2.log` `doc-route`). In a browser with a PDF viewer it opens as a tab showing the prescription.
2. Sign out in the app tab.
3. The PDF tab runs no app JavaScript. No `PwaRuntime` listens there, so neither the BroadcastChannel nor the storage event reaches it, and it keeps the prescription on screen until someone closes it.
4. A lab document or referral tab sits on the Supabase storage origin with a signed URL. It stays on screen and can be **reloaded or copied for up to an hour** after sign-out, because the purge and `Clear-Site-Data` do not reach another origin.

Steps 3 and 4 follow from how the tabs are built. Headless Playwright downloads PDFs instead of showing them, so I proved the
inline disposition and the absence of a listener, not a screenshot.

**Impact:**
- This is the M-2 scenario (the next person at a shared front desk finds the previous user's patient document open)
  through a tab type the fix cannot reach.
- The behaviour predates V2-06 (v1). It is not a regression of 06-09a.

**Fix (pick per document type):**
- Open documents in an in-app viewer route under `app/(dashboard)/` (an `<iframe>`/`<embed>` of the same-origin PDF
  route). `PwaRuntime` then hides the page and leaves on the signal like any app tab.
- For the cross-origin signed URLs, use a short TTL for view links (for example 60 s; the browser fetches at once) or
  proxy them through a same-origin authenticated route, so a reload after sign-out fails.
- Add a two-tab e2e: document viewer tab + sign-out tab.
- If the PO prefers to accept this for Wave A, record it against M-TABS with an owner (06-04b shell or V2-14).

## M-ERRCAP: CLOSED

**Original reproduction, re-run** (`errcap-node-probe.txt`):
- Review C's inputs are all stored as `client.Error @ /` (or keep only a listed route), with an empty message and no frames:
  - `Ravi_Kumar_ph_98765-43210` with `/patients/[Ravi_Kumar_98765_43210]`;
  - `aadhaar-1234-5678-9012`;
  - `Asha.Rao.F.52.HbA1c-9.8` with `/patients/asha-rao/hiv-positive`;
  - `Pat.ravi.example.com`.
- New spellings all fold to the fallback:
  - `/patients/[id]/` (trailing slash), `/patients/[ID]`, a zero-width space, fullwidth letters;
  - `?q=` and `#x` suffixes;
  - a 199-character route;
  - `__proto__`, `constructor`, `hasOwnProperty`, `toString` as names;
  - `TypeError\u0000`.
  The lookups use `Set.has`, so prototype keys cannot match.
- Ten simulated instance lifetimes with 200 junk keys each, plus every listed name × route, give at most the keyspace:
  `CLIENT_KEYSPACE` = **144** (8 names × 18 routes; `/` is already in the generated list). Clients cannot reach the shared
  500/day cap.
- Repeat debounce sequence at 0 / 1 s / 59.999 s / 60 s / 60.5 s: `new, debounced, debounced, repeat, debounced`.
- `ops_ingest_error` is still behind the ingest key (000029: execute is granted, but the function checks a sha256 key),
  so the action is the only client door.

Info N-7: the record says the keyspace is "8 × 19 = 152"; the code gives 144. Harmless, but the record overstates it.

## M-OFFLINE: CLOSED (Chromium); WebKit offline unverifiable in Playwright

**Original reproduction, re-run** (`rv-swupdate.log`): `npm run e2e:sw-update` passed. Two real builds (`LiIBsT_…`,
`LdQWtSYr…`) gave different stamps, the device's `update()` installed B, `shell-A` was deleted, and offline `/offline`
carried B's `data-sw-build` and rendered styled.

**My probes (`rv-run1.log`):**
- **`/sw.js` headers**:
  - signed out: `no-cache, no-store, must-revalidate`;
  - signed in: `private, no-cache, no-store, must-revalidate, max-age=0` (the proxy's value wins; still no-store);
  - CSP `default-src 'self'; script-src 'self'`;
  - no `Service-Worker-Allowed`, so the scope is capped at `/`;
  - no `Set-Cookie`.
- **Stamp**: 1 distinct stamp over 6 requests (fixed per build, inlined at build time). Its predictability does not
  matter: it is only a cache name and is public in `/sw.js` by design.
- **Path variants**:
  - `/sw.js?x=1` serves the same no-store worker;
  - `/sw.js/` answers 308 to `/sw.js`;
  - `/SW.JS` and `/sw.js%3F` answer 307 to `/login`.
- **Shell cache** (Chromium and WebKit, online): exactly one `shell-<stamp>` matching the served stamp; 7 entries
  (5 shell URLs + stylesheets); 0 `<script>` in the stored `/offline`.
- **Offline navigation (Chromium)**: title `Offline · CliniQ AI`, Inter font stack, 2 stylesheets, h1 "You're offline".
  WebKit cannot navigate offline under a worker in Playwright (see H-WEBKIT).
- Info: a long-lived PWA window keeps the old worker (and the old `/offline`) as *waiting* until every window closes.
  The `SKIP_WAITING` update toast is 06-06's; the record already lists it.

## M-GUARD: CLOSED for the named spellings; residual N-3

- On the repository: `signout-guard [enforce] 0 finding(s)`.
- `features/auth/password-flows.ts` calls `hardSignOut("recovery")`.
- `features/auth/service.ts` keeps `import "server-only"`.

**Fixtures run through the rule** (`guard-bypass.txt`):
- **Flagged**:
  - `auth["sign" + "Out"]` in a `.js` file;
  - `c.auth.signOut()` in a `.mjs` file;
  - `` `sign${"O"}ut` ``.
- **Not flagged** (N-3):
  - `const x = createClient().auth; x[["sign","Out"].join("")]()` and `const a = createClient().auth; a[k]()` (auth aliased to another name, key not foldable);
  - `c["auth"][k]()` (element access to `auth`; `isAuthObject` only knows identifiers and `.auth`);
  - `String.fromCharCode(…)` keys;
  - `Object.getOwnPropertyNames(proto).find(n => n.startsWith("signO"))`;
  - `fetch(url + ["/auth/v1","logout"].join("/"))`;
  - expiring the `sb-*` cookies by hand (`document.cookie = name + "=; Max-Age=0"`) and navigating: a device sign-out with no purge or broadcast, which the rule does not cover.

### N-3 (Low): the guard still passes deliberate obfuscation and manual cookie expiry

A lint rule cannot be complete, and none of these is an accidental spelling.

**Fix (cheap):**
- Treat `x["auth"]` like `x.auth`.
- Flag any `.join(…)`/call-built key used for element access on a variable initialised from `*.auth`.
- Flag string fragments `"/auth/v1/"` (not only the full logout path).
- Flag writes to `document.cookie` that contain `sb-` or `Max-Age=0` outside `lib/auth/hard-sign-out.ts`.

## New findings beyond the six

### N-2 (Low): the signing-out tab keeps the patient screen visible and interactive until the server call ends (up to 5 s; up to 8 s in the worst case)

**Where:** `lib/auth/hard-sign-out.ts` `run()`. `deps.conceal()` runs only in the `finally`, after steps 1 to 4. Other tabs
hide at once (`PwaRuntime`), but the tab doing the sign-out does not.

**Reproduction** (`hard-sign-out-node-probe.txt`): with hung steps, `conceal` is logged only after the 8 s deadline. On a
slow 4G link the fetch alone can take up to the 5 s cap, and during that time the menu says "Signing out…" over live
patient data.

**Fix:** call `deps.conceal()` (or a lighter "signing out" overlay that covers the content) right after `runCleanups`,
before the server call, for every reason except `recovery`. The final `conceal()` stays as the backstop.

### Info

- **N-4:** On WebKit offline, the hidden and inert patient DOM stays in memory until the next navigation (see H-WEBKIT).
  This is acceptable, and the iOS real-device check stays with 06-P.
- **N-5:** `POST /auth/signout` (fetch caller, same-origin) with no session cookie answers `200 {revoked:true}`.
  Nothing was revoked, because there was nothing to revoke. For "everywhere" this reads as a success the server did not
  check. It is reachable only when the device has already lost its cookies while still showing the app, which every
  other path now prevents. Optional: answer `{revoked:false}` (409) when there was no session and the scope is `global`.
- **N-6:** In Playwright WebKit the storage-event fallback cannot be tested, because no `storage` events arrive between
  pages at all. It only matters for Safari before 15.4, which has no BroadcastChannel and is below Next 16's supported
  browsers. Chromium shows that the fallback works.
- **N-7:** The keyspace is 152 in the record but 144 in the code (see M-ERRCAP).

## Legitimate-path regressions: none found

`rv-legit.log`: `tests/e2e/pwa/*`, `tests/e2e/auth/signout.spec.ts` and `tests/e2e/observability/client-error.spec.ts` on
desktop-chrome, pixel-7 and iphone-15 gave **75 passed, 0 failed, 20 skipped** (project filters), 0 retries.

| Area | Result |
|---|---|
| **Sign-out** | Normal Sign out, Sign out of all devices, Switch user, and offline sign-out (exit paths, `@golden`) pass on all three projects. My own probes landed on `/login` in 270–283 ms on chrome, pixel-7 and webkit, with a clean device. |
| **Install** | `01-manifest` (manifest, icons, `/sw.js`, `/offline` content types) and `02-installable` (Chrome reports no installability errors) pass. `03-sw` passes: registration with scope `/` and `updateViaCache: none`, headers, and a precache of 150 kB or less with stylesheets. |
| **Offline page** | `04-offline` passes on Chromium projects. `ui-checks`: `/offline` at 360, 820, 1180 and 1280 px has no horizontal scroll and is axe clean. |
| **Error capture of a real render error** | `client-error.spec.ts` passes: the boundary hides the message and the row lands once in `ops.error_events`. |
| **Original adversarial specs** | All 16 pass (`rv-adv.log`). |

The `[WebServer] ⨯ internal image response failed for /patients 307` lines in `rv-adv.log` come from review A's
`/_next/image?url=/patients…` probe, which the proxy redirects to `/login`. They are expected.
