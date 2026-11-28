# V2-14 notes

Execution notes for `14-PLAN.md`. Lane 14a (branch `v2/phase-14a-headers-scanners`): plans 14-01 and 14-02, the parts
that need no migration. CTO authority delegated by the PO (deadline 6 Dec 2026); CTO-1 accepted: ZAP against the local
e2e server only (CI), the PO runs a `curl -I` header check on staging (14-P3).

## DECISIONS

Small decisions taken in lane 14a. Each one is reversible in a follow-up PR.

| # | Decision | Why |
|---|---|---|
| D-14a-1 | The CSP is **enforced** from the first PR, not shipped Report-Only first. The violation collector is in the shared e2e fixture (`tests/e2e/fixtures.ts`): every PR-lane test, on every device project, fails if any page reports a `securitypolicyviolation`. | The plan's Report-Only tracer exists to find violations before enforcing; the fixture finds them the same way (the event fires in both modes) on the whole lane at once, and an enforced policy is what ships. CI is the oracle. |
| D-14a-2 | `style-src 'self' 'unsafe-inline'` (no style nonce). | React server-renders `style="…"` attributes; a nonce cannot cover attributes, and with a nonce present browsers ignore `'unsafe-inline'`, which would break every inline style. Style injection is a far smaller risk than script injection; scripts stay nonce-only with `'strict-dynamic'`. |
| D-14a-3 | Every page renders per request (`await connection()` in `app/layout.tsx`); `/offline` loses `force-static`. | A nonce can only reach the scripts of a page rendered for that request. Four pages were static (`/login`, `/forgot-password`, `/offline`, the 404); none reads data. The service worker still precaches one `/offline` copy with its scripts stripped (no nonce needed offline). |
| D-14a-4 | No `/api/csp-report` endpoint in this lane (no `report-to`/`report-uri`). | A new unauthenticated POST route needs a guard-manifest category, its DB-backed legs and a rate limiter: 14-03/14-05 scope. The e2e collector covers the PR lane meanwhile. Forward item F-1. |
| D-14a-5 | Page headers come from `proxy.ts` (per request: CSP, Referrer-Policy, Permissions-Policy, COOP, X-Frame-Options, `no-store` on token pages); HSTS and nosniff from `next.config.ts` for every path (static assets included). `/api/**` and `/sw.js` get no page CSP (their own headers). | One place per kind of header; route handlers serve JSON and PDFs (the receipt PDF is framed by the app, so `/api` cannot carry `frame-ancestors 'none'`). |
| D-14a-6 | Camera allowed only on `/consultation/*` and `/patients/*` (the report upload's `<input capture>`); microphone, geolocation, USB and payment off elsewhere; payment and `same-origin-allow-popups` only on the billing pages. | Plan 14-01 step 3. No page uses `getUserMedia` today; the scribe (V2-12) widens `microphone` on the consult when it ships. |
| D-14a-7 | Semgrep: custom rules one per file in `semgrep/rules/`, fixtures in `lint-fixtures/semgrep/` checked by `semgrep --test` in CI; community packs from the registry (download only, `--metrics=off`). Any ERROR finding blocks; exceptions are `nosemgrep: <rule> -- <reason>` comments at the line. `lint-fixtures/semgrep` is excluded from `tsconfig.json` (the fixtures are deliberately broken code). | Plan D-2; a reviewed, greppable exception at the line beats a central ignore list. |
| D-14a-8 | `admin-query-without-tenant` does not flag primary-key reads (`.eq("id", …)`): a job or event that names its row reads that row and then its tenant. | The rule's target (SEC-05) is unscoped list reads; flagging every id lookup would bury it in `nosemgrep` comments. |
| D-14a-9 | OSV-Scanner blocks on **production** dependencies only (the `npm audit --omit=dev` scope), high/critical with a fix, honouring the same expiring allowlist (`.github/audit-allowlist.json`); malicious-package (`MAL-`) entries block in any scope; dev-only and unfixed findings are reported in the step summary. | Dev tools run in CI only, never in the shipped app; one waiver list for both SCA gates. Today: 2 production highs, both already waived (zod 3, jsondiffpatch; owner V2-12 P1-19); dev criticals/highs (tinypool, basic-ftp, extract-zip, tmp) go to 14-TRIAGE.md. |
| D-14a-10 | ZAP runs in its own CI job `zap` (not one of the five required checks): unauthenticated baseline, two-minute spider, against the `e2e:build` output on 127.0.0.1:3100 with the loopback stack; High blocks (`scripts/security/zap-gate.mjs`). The authenticated baselines (receptionist, owner contexts) and the nightly run are not in this lane. | Keeps the e2e job inside its 95-minute budget and the required-check names unchanged. Forward item F-2. |
| D-14a-11 | `supabase db lint --fail-on error` and `supabase db advisors --type security --fail-on error` in the `test` job, after the migrations are checked. | SVP §2 "Supabase DB lint, block on security lints": splinter's security lints are the CLI's `db advisors`; `db lint` is plpgsql_check. Warnings are printed for triage. |
| D-14a-12 | Scanner artefacts (`security-scans`, `zap-baseline`) are kept 90 days, the Actions maximum without a repository setting; the 1-year evidence copy (SVP §11) is the phase evidence bundle at close. | Forward item F-3. |
| D-14a-13 | SBOM (`npm sbom`, CycloneDX, production) is a CI artefact; the licence check reads it at triage (report only) instead of adding `license-checker`. | No new dependency (CLAUDE.md); no licence policy beyond the CDCI review exists yet. |
| D-14a-14 | Upload hardening (plan D-8): a declared `content-length` above 4.5 MB on an upload page is refused (413) before any session work, signed in or not. Unsized bodies there still need a session (09B-06a). | Closes the "buffered towards the 4 MB action limit" residual for requests that cannot succeed. |
| D-14a-15 | P2-06 filter inputs: `/api/v1/visits` `start_date`/`end_date` must be ISO dates or instants (`isIsoDateParam`) before they reach `.or()`; the receipt lookup checks its id inside `compileReceiptPayload` (both the route and the public share path). Every remaining interpolated `.or()` carries a `nosemgrep` naming its validation. | The Semgrep rule found the v1 dates unvalidated (tenant-scoped by `.eq("tenant_id")`, so no cross-tenant read: Low). |

## Forward items (not in lane 14a)

| # | Item | Owner |
|---|---|---|
| F-1 | `/api/csp-report` (rate-limited, no query stored, `ops.error_events`) + `report-to` in the policy | 14-03 / 14-05 |
| F-2 | ZAP authenticated baselines (receptionist, owner contexts) and the nightly run blocking on High; `tests/fixtures/security-seed.ts` | 14-03 |
| F-3 | 1-year retention of scanner reports: copy SARIF/JSON into the phase evidence at close | 14 close |
| F-4 | The Razorpay checkout is not wired into the client yet; when it is, re-check `script-src` (strict-dynamic loader) and the popup flow under COOP on the billing pages | V2-13 owner |
| F-5 | Header spec over the full guard-manifest route list (today: page, token page, `/api`, worker variants, signed-in pages) | 14-03 |
