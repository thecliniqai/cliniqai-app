---
phase: "14"
roadmap_id: V2-14
name: Security verification & closure
revision: "2026-11-28, first revision (CTO under the PO's delegation; deadline 6 Dec 2026)"
gate: "G5: adversarial Claude security reviewer (Opus, fresh context, read-only) + automated scanners; no external tester (PO-17). One PR (scanner wiring and fixes). Evidence: scanner reports (SARIF/JSON) from CI, the authZ matrix report, the ZAP baseline report against the local e2e server, the adversarial review report, the triage log and the risk-acceptance register. 0 Critical/High open; Mediums fixed or risk-accepted by the PO (or by delegation, listed for the PO's G6 review)."
requirements: ["V2_MASTER_ROADMAP §12.2 V2-14 (scope incl. the new-track checks), §15 items 1-3 and 11, §16 G5", "SECURITY_VERIFICATION_PLAN §2-§7, §9-§11", "P1-18 (headers, nonce CSP with worker-src/manifest-src), P2-06 (SSRF, filter input, generic errors, share-link hygiene, upload hardening), P1-41 (coverage enforced)", "AUTH-08/09 verification, FT-05, FT-06", "SUB §11 security row, §14.9 security; AI_STRATEGY gating and prompt-injection checks; PO-21 no AI purchase path", "Items routed to V2-14 by earlier phases (see 'Inherited items'), incl. the 09E deferred nits and the consult route JS size"]
plans: ["14-01", "14-02", "14-03", "14-04", "14-05", "close"]
order: "14-01 -> 14-02 -> 14-03 -> 14-04 -> 14-05 (adversarial review, triage, fixes, risk acceptances) -> close"
preconditions: "V2-01..V2-13c merged into feature/v2."
migrations: {"14-03/14-05": "000200_security_fixes_a, 000201_security_fixes_b (only if fixes need SQL)", "14-05": "000202_contract_cleanup (redundant jobs_tenant_id index; revoke UPDATE (vitals) after record_vitals)", "spare": "000203, 000204"}
migrations_note: "Reserved 000200-000204. This phase adds SQL only for fixes; each fix migration carries its pgTAP and registry bumps."
new_dependencies: "No npm dependency. CI tools, pinned and checksum-verified like gitleaks (scripts/ci/install-*.sh): Semgrep OSS (pinned container image digest), OSV-Scanner (pinned release binary), OWASP ZAP baseline (pinned container image digest `zaproxy/zap-stable`). Why: SVP §2-§7 model-independent checks against R13 (self-review blind spots). None uploads repository content anywhere (Semgrep with --metrics=off and no login)."
branch: "v2/phase-14-security-verification -> PR into feature/v2"
---

# V2-14 Security verification & closure: plan

## Goal

Independent, tool-produced proof that the Critical and High findings are closed and nothing new is open, across the
whole v2 surface including subscriptions, webhooks, platform admin, export/purge and AI gating: headers and a nonce CSP
live; SAST, SCA, secret and DB-lint scans blocking in CI; a generated authZ matrix (roles × access levels × tables ×
operations, plus every server action and route) green; a ZAP baseline against the local e2e server with no High; the
billing, admin and AI abuse cases tested; an adversarial review over the full tree; every finding triaged, every Medium
fixed or risk-accepted, coverage floors enforced.

Tracer: 14-01 ships the CSP in `Report-Only` for one route group first, with a spec asserting the header and a CSP
violation collector, then enforces it everywhere once the e2e lane shows zero violations.

## Decisions (CTO)

| # | Decision | Rationale |
|---|---|---|
| D-1 | ZAP runs only against the local e2e server (`next start` on 127.0.0.1:3100, loopback stack), passive baseline on every PR's e2e job (report) and nightly (blocking on High), plus an authenticated baseline with a receptionist and an owner context; never against staging, hosted Supabase, Razorpay, MSG91 or AI providers | Caller instruction and CLAUDE.md (no hosted targets from tools); SVP §7 "local and staging" is satisfied in its local half; a staging scan stays a PO-optional action (14-P4) |
| D-2 | Semgrep custom rules from SVP §2 (1, 3-9) plus three new: `billing-state-from-request` (a `billing_internal`/`apply_provider_state` call fed by `req`/`formData` values), `platform-import-outside-group`, `signed-url-in-notice` | The new tracks' invariants as code |
| D-3 | The authZ matrix is generated, not hand-written: the table list from `information_schema` (every `tenant_id` table) × {select, insert, update, delete} × {owner, admin, doctor, nurse, receptionist, removed, other-tenant, anon} × access levels {full, onboarding, locked, none}, asserted against one policy file `tests/security/policy-matrix.ts`; server actions from `npm run inventory`, routes from `tests/security/guard-manifest.ts` | SVP §6; roadmap §15 item 2 "100 % of tables" |
| D-4 | Nonce CSP set in `proxy.ts` per request (`script-src 'nonce-…' 'strict-dynamic'`), `connect-src` self + the Supabase origin (https and wss for Realtime) + `api.razorpay.com`/`lumberjack.razorpay.com` only on `/onboarding/billing`, `/settings/billing`, `/billing/locked`; `frame-src` Razorpay and Turnstile hosts only where used; `worker-src 'self'`, `manifest-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`; `report-to` the existing `ops.error_events` path (`/api/csp-report`, rate-limited, no URL query stored) | P1-18; inherited 08/06 notes on Realtime wss and PWA |
| D-5 | Coverage enforcement at the G2 thresholds (80 % lines / 70 % branches) on `lib/**` and `features/**` domain modules only; UI components report-only; thresholds in `vitest.config.ts`, measured from the evidence run, lowered nowhere | P1-41; 02-SUMMARY |
| D-6 | The 09E deferred nits (N-1..N-13, adversarial N3/N6/N7) are triaged here, not in a 09E follow-up: each fixed if cheap and local (< 30 min), else backlog with an owner phase (v2.1) or a risk acceptance | The 09E notes asked "09E-14a or V2-14?"; V2-14 is the sweep (VERIFICATION_LOG 2026-11-14/15) |
| D-7 | Consult route JS (387.7 kB gz vs 200 kB, report-only): set a measured ceiling = today's size + 2 % (blocking from this phase, so it cannot grow) and cut what is cheap (dynamic import of the PDF viewer, scribe panel and Rx print view behind their triggers); the 200 kB target goes to V2-15's budget recalibration (06-07 R-5) with the framework floor | Blocking growth now; recalibration belongs with LHCI blocking in 15-05 |
| D-8 | Uploads stay capped at 4 MB (PO-ACTIONS 3.3 default) and the 26 MB unauthenticated-buffer residual is closed by rejecting on `Content-Length` before reading the body in the route; direct-to-Storage uploads stay v2.1 | Removes the DoS risk without a redesign |
| D-9 | DB-side session liveness (`session_is_live()` inside the definer commands and the `api_keys`/`webhook_subscriptions` insert rules; 09D R-S): added to the sensitive commands only (staff, keys, webhooks, settings, billing owner actions, export, refund), measured with `command-latency.ts` (budget + 1 ms p95) | Closes the residual where it matters, without taxing hot queue commands |
| D-10 | The trusted `rx.archive` job question (09A R-A) is closed as a risk acceptance: the signer's PDF is written at sign time (09A); "signer left before archive" only delays the archive copy, which the job retries under the clinic | No PO decision needed for UAT; listed in the register |
| D-11 | Risk acceptances are signed in `docs/v2/RISK_REGISTER.md` (new) with id, finding, rationale, owner, review date; the PO signs at G5 or the CTO by delegation with "PO to confirm at G6" | §16 G5 requires PO-signed acceptances; deadline |

## CTO decisions needed

| # | Conflict | Source | Recommendation (default) |
|---|---|---|---|
| CTO-1 | ZAP baseline "on staging" (roadmap V2-14 scope, SVP §7, G5 evidence) vs the brief's "local e2e server only" | V2_MASTER_ROADMAP §12.2 V2-14; SVP §7 | **Local e2e server only for the gate** (D-1): the local server runs the same production build as staging; staging differs only in hosting headers, which 14-01's header spec checks on the build and the PO's 2-minute `curl -I` against staging (14-P3) confirms. A staging ZAP run stays optional (14-P4) |

## Inherited items (routed to V2-14)

| Item | Source | Plan / disposition |
|---|---|---|
| CSP `worker-src`/`manifest-src`; Realtime wss in `connect-src` | 06-05, 08-PLAN | 14-01 |
| SSRF redirect/DNS hardening (P2-06, E-2) | 03 adversarial SSRF | 14-02 (TC-SSRF-01..05) |
| Coverage thresholds blocking | 02-PLAN/SUMMARY | 14-05 (D-5) |
| Audit-allowlist entries owned by V2-14 | 02/03 | 14-02: each renewed with a date or removed |
| `service_role` reading `vault.decrypted_secrets` | 04-07 triage | 14-03: least privilege check; revoke if unused outside the runner |
| IND L5 dead-letter counts; `backup_runner_stale` accepts any ok pass; `runner_stale` null `last_ok_at`; `replay_job` resets attempts not deferrals | 04-07/04-07b | 14-05 fix (cheap SQL in 000201) |
| Redundant `jobs_tenant_id` index | 04-07d/e | 14-05 contract migration 000202 |
| LHCI scrub list misses chunked `base64-` session cookies (C Info I-2) | 06-09a | 14-02 (fix the scrubber; test) |
| Sign-out grep guard bypass (N-3) | 06-09a | 14-05 review backstop; accepted |
| Deployment id exposure, `suspended` = removed, `/SW.JS` header quirk | 06-09c | 14-01 (header spec covers case variants), 14-05 triage |
| Per-user rate limit on the client-error action | 06-04a | 14-02 (Postgres limiter) |
| `40P01` → `CONCURRENT_WRITE` end-to-end test (T-2) | 07 triage | 14-03 |
| Hosted "public Realtime" off (S-10) | 08 triage | 14-03 local test + PO check (14-P3) |
| Column grants on queue token timestamps (S-11) | 08 triage | 14-03 |
| `hardSignOut` purge capped at 3 s; `/offline` does not re-purge | 08 triage | 14-05 triage (fix if cheap: `/offline` re-runs the purge) |
| `record_vitals` definer command, then revoke `UPDATE (vitals)` (S-3); `specialty_data` validation (S-4) | 09B | 14-05 fix (000201/000202) |
| Upload > 4 MB / unauthenticated buffer | 09B/09C | 14-02 (D-8) |
| Consult route JS size | 09B/09C | 14-05 (D-7) |
| Today `max_rows = 1000` truncation | 09B | 14-03: assert the board read paginates or errors visibly; fix if silent |
| `search_diagnoses` p95 39 ms vs 50 ms | 09B | 14-05 triage (watch; no change) |
| 09C A-10, A-13, A-18, A-20; Today 10 px overflow at 820 | 09C | 14-05 triage: cheap UI fixes or v2.1 backlog |
| `session_is_live()` in definer commands (09D R-S) | 09D | 14-03 (D-9) |
| 09E N-1..N-13, N3, N6, N7 (incl. N-11 42-day slot cap ~400 definer calls; N7 DST gap) | 09E-NOTES | 14-05 (D-6); N7 fixed (a DST gap must not fail a range: clinics are IST, but zones are per clinic) |
| E-L6 ChangedElsewhere flash after own save; Sign & Bill `expectedVersion`; full-load latency rows; `schedule_range` 42-day p95 369 ms | 09E-NOTES (no owner) | 14-05 triage; Sign & Bill `expectedVersion` fixed (lost-update class) |
| Trusted `rx.archive` job | 09A | 14-05 risk acceptance (D-10) |
| H-AUTH residual (~1,500 s token after the 600 s bound); emailed-code token age; hook `webhook-id` memory per instance | 03-13/03 wave notes | 14-03 verify against FT-06/AUTH-09 (V2-11); residual → risk register until Pro time-box (V2-16) |
| Per-account limiter on current-password guessing (D L-1) | 03-13 | 14-03 verify (V2-11/13b), fix if missing |
| Invite resend idempotency / throttle | 05-07b, 05b | 14-03 verify (13B-02 or V2-12), fix if missing |
| AI I-1, I-6, I-7; ACC Info; IND I-3 | 05b triage | 14-05 triage |

## Shared rules

09E and 13B shared rules apply. Additionally: scanners run in CI and write SARIF/JSON artefacts kept 1 year (SVP §11);
findings are recorded in `.planning/phases/14-security-verification/14-TRIAGE.md` with SEC ids, severity, status
(Open/Fixed/Verified/Risk-accepted), the test that proves the fix (fails-without for every High) and the commit; nothing
is typed into VERIFICATION.md by hand. Security-sensitive files: everything this phase touches.

## Plans

### 14-01 Security headers and nonce CSP (P1-18) · M · no migration

Files: `proxy.ts` (nonce + headers), `next.config.ts` (static headers for assets/SW kept), `app/layout.tsx` (nonce to
scripts), `app/api/csp-report/route.ts`, `lib/security/csp.ts`, `tests/security/{headers,csp}.spec.ts`,
`tests/e2e/security/csp-violations.spec.ts`.

1. Tracer: Report-Only on `/login` and `/today`; e2e collects violations (CDP `securitypolicyviolation` listener).
2. Full policy (D-4) per route group, Report-Only across the PR lane; fix every violation (inline styles from libraries
   via nonce or hashes; Turnstile; Razorpay modal; Realtime wss; RUM beacon; service worker).
3. Enforce. Headers: HSTS (preload-ready), `X-Content-Type-Options`, `Referrer-Policy` (`strict-origin-when-cross-origin`;
   `no-referrer` on PHI, token and onboarding pages), `Permissions-Policy` (camera only on capture routes),
   `Cross-Origin-Opener-Policy: same-origin`, `no-store` on PHI and token pages; `/SW.JS` and case variants served as the
   SW route expects.

Tests: header spec over a route list from the guard manifest (every page group, `/r/x`, `/api/v1/*`, `/platform`,
webhooks); CSP e2e zero violations on the PR lane journeys (desktop, Pixel 7, iPhone 15); a forged inline script is
blocked (fails-without: with `unsafe-inline` the injected script runs).
Done: enforced CSP, zero violations, header spec green.

### 14-02 Scanners in CI, P2-06 hardening · M · no migration (or 000200 if a fix needs SQL)

Files: `.github/workflows/ci.yml` (security job: Semgrep, OSV-Scanner, `supabase db lint` in the test job, license check,
SBOM artefact), `.github/workflows/nightly.yml` (ZAP baseline + authenticated baseline against the local e2e server),
`scripts/ci/install-{semgrep,osv,zap}.sh` (pinned digests/checksums), `semgrep/rules/*.yml` (D-2) with positive and
negative fixtures in `lint-fixtures/semgrep/`, `zap/{baseline.conf,contexts/*.context}`, `scripts/security/zap-local.mjs`,
P2-06 fixes in `lib/webhooks/ssrf.ts`, upload routes, filter parsing, share links; `tests/security/{ssrf,uploads,filters}.spec.ts`.

1. Semgrep (community packs + custom) blocking on ERROR; OSV blocking on high/critical with a fix; `npm audit` gate kept;
   `supabase db lint` blocking on security lints; license check (CDCI licence reviewed separately); SBOM.
2. ZAP: the script starts the e2e server against the loopback stack (existing `e2e:build` output), seeds two tenants with
   every role (`tests/fixtures/security-seed.ts`), runs the passive baseline and the authenticated baselines, excludes
   `/api/webhooks/*` and `/api/jobs/*` from spidering, writes JSON + HTML; PR e2e job: report-only step; nightly: blocking
   on High.
3. P2-06: SSRF TC-SSRF-01..05 (302 to metadata IP, DNS rebinding with a mock resolver, `::1` forms, NAT64, decimal IPv4);
   filter inputs zod-validated (no `.or()` interpolation, SEC-20); generic errors; share-link hygiene (no-referrer, no
   token in logs); uploads (D-8 `Content-Length` refusal before reading, magic bytes kept, object keys without names).
4. Fix every scanner finding at High; triage the rest into 14-TRIAGE.md.

Tests: each custom rule has a fixture that must match and one that must not (CI runs Semgrep on the fixtures); ZAP report
parsed by `scripts/security/zap-gate.mjs` (fails on High; its own unit test with a sample report).
Done: scanners blocking; ZAP baseline with no High (report linked in evidence).

### 14-03 AuthZ matrix, tenant isolation and auth verification · L · migration 000200_security_fixes_a (if needed)

Files: `tests/security/policy-matrix.ts`, `scripts/security/gen-authz-matrix.ts` (extends `npm run authz:gen`),
`supabase/tests/database/authz_matrix.test.sql` (generated), `tests/security/{server-actions-matrix,routes-matrix,locked-tenant,platform-from-tenant,billing-internal-grants,storage-locked,share-token-lock,auth-session}.spec.ts`.

1. Generated pgTAP matrix (D-3) incl. subscription access levels and storage objects per bucket; every new 13b/13c table.
2. Server actions × roles (inventory) and routes × roles (guard manifest) with real sessions (no overrides): unauth,
   wrong role, other tenant, locked tenant (`SUBSCRIPTION_LOCKED`), removed staff with a still-valid JWT; SVP TC-SA, TC-RLS-MEM,
   TC-STAFF, TC-TOK, TC-WH, TC-API, TC-HDR, TC-RED, TC-AUD, TC-DPDP families.
3. New-track checks: `platform.*` from tenant sessions and aal1; `billing_internal` not executable by `anon`/`authenticated`;
   locked-tenant RLS, storage, server actions, `/api/v1` (402) and Realtime denial; share-token revocation on lock; export
   URL scope (another owner, admin, expired); `/api/v1` 404 in a production build (C50).
4. Auth: AUTH-08/09 (owner TOTP gating, `requireRecentAuth`, platform two factors), FT-05 leaked password refused, FT-06
   14-day/7-day sign-out (time travel), sign-out everywhere, session liveness in sensitive commands (D-9), login and
   current-password limiters, invite throttles; the inherited auth residuals verified or registered.
5. Inherited DB checks: `40P01` → `CONCURRENT_WRITE` e2e, queue token column grants, `vault.decrypted_secrets` access,
   Today `max_rows` behaviour.

Tests: as listed; the matrix report (cells, passes) is a CI artefact. Fails-without (High: matrix catches a hole): drop one
RLS policy line in a scratch migration → the generated matrix fails on exactly that cell; recorded, reverted.
Done: matrix 100 % green incl. platform RPCs and `billing_internal` (roadmap §15 item 1).

### 14-04 Billing, admin and AI abuse tests · M · migration 000201_security_fixes_b (if needed)

Files: `tests/security/abuse/{webhook-forgery,coupon-bruteforce,redemption-race,refund-replay,ai-gating-bypass,scribe-prompt-injection,no-ai-purchase}.spec.ts`,
`tests/e2e/security/abuse.spec.ts`.

1. Webhooks: forged signature, valid signature with another tenant's `notes`, replayed event id, out-of-order, oversized,
   unknown type, signature over a re-serialised body (must fail: raw body only).
2. Coupons: enumeration (uniform message and timing within a bound; the limiter trips at 5/15 min per user and per IP,
   20/day per tenant), 50 parallel redemptions of one single-use code (exactly one applies), stacking attempt, tampered
   client price or code state.
3. Refunds: retried job, concurrent refunds over the cap, aal1 admin, tenant session; Dashboard refund import.
4. AI: every gate bypass (non-entitled, opted out, objected, over quota, killed, locked) through the server action, the
   route and `/api/v1` returns its message without a provider call (mock provider records zero calls); prompt injection in
   transcript and patient fields cannot change the system prompt, call tools or leak another patient (mock captures the
   outbound body: pseudonymised, no phone numbers); no route, action or RPC can buy an AI product (PO-21; inventory scan
   for `ai_assist`/`ai_voice_receptionist` purchase paths returns none, `set_product_availability` refusal).

Done: every case green; findings into 14-TRIAGE.md.

### 14-05 Adversarial review, triage, fixes, risk acceptances, coverage, route budgets · L · migration 000202_contract_cleanup (+ 000201 if needed)

1. Adversarial review (Opus, fresh context, read-only tools, its own checklist from SVP §8 and THREAT_MODEL): every
   service-role use, every `"use server"` export, every public route, every SECURITY DEFINER function, every storage policy,
   the new tracks (billing, platform, export/purge, AI), the CSP. Output `reviews/v214-review-adversarial.md`.
2. Triage every finding (14-TRIAGE.md). Fix Critical/High with fails-without tests; Mediums fixed or accepted (D-11);
   Lows cheap-and-local or backlog with owner. The inherited list above is dispositioned row by row.
3. Fixes queued from the inherited list: Sign & Bill `expectedVersion`; 09E N7 DST gap; `record_vitals` + revoke; S-4
   validation; jobs small fixes; redundant index contract; LHCI scrubber; `/offline` re-purge.
4. Coverage enforcement (D-5) from the evidence run; route JS ceiling for the consult and the cheap cuts (D-7).
5. One re-check of Highs by a second fresh adversarial reviewer (only the fixed Highs).

Done: 0 Critical/High open; register signed; coverage floors met; consult JS not above its ceiling.

### Close

1. Evidence: `npm run stack:recycle`; `node scripts/phase-evidence.mjs .planning/phases/14-security-verification/evidence 2`
   (two runs: security phase); push; CI green with 0 retried; `--ci-run <id>`; nightly run id for ZAP; artefacts linked.
2. Docs (Haiku): `14-SUMMARY.md`, `14-VERIFICATION.md`, `SECURITY_ASSESSMENT.md` status column per SEC id,
   `docs/v2/RISK_REGISTER.md`, VERIFICATION_LOG entry, roadmap status, PO-ACTIONS 14-P1..P4.
3. Gate G5: the PO approves (or by delegation, recorded, with the risk register flagged for the PO at G6).

## Threat register

This phase verifies the threat registers of V2-01..V2-13c; it adds T-14-01 (scanner supply chain, high: pinned digests,
checksums, no uploads, `--metrics=off`) and T-14-02 (CSP regressions break checkout/Turnstile, medium: per-route
`connect-src`/`frame-src`, e2e violation collector on the device matrix).

## PO actions

- **14-P1** Sign the risk register at G5 (or confirm the delegated signatures at G6).
- **14-P2** Answer CTO-1 (default applies).
- **14-P3** Read-only checks on staging (5 minutes, Claude prints the commands): `curl -I` on three URLs for the headers;
  Supabase dashboard: Realtime "public access" off, Storage buckets private.
- **14-P4** Optional: a ZAP baseline against staging from the PO's machine with the provided config (never against
  production).

## Out of scope

External penetration test (PO-17; recommended before scaling beyond the pilot), DAST against any hosted system,
direct-to-Storage uploads (v2.1), class-level allergy checks.

## Execution (lean process)

- Executors: Opus for 14-03, 14-04, 14-05 fixes and the reviews; Sonnet for 14-01, 14-02 wiring; Haiku for docs. Never
  set a mode on a subagent. Full PR lane after 14-01 (CSP touches every page) and once at the end; CI runs everything.
- Fails-without: 14-01 inline script; 14-03 dropped policy cell; one per fixed High in 14-05.
- Target calendar: 4 Dec (1.5 days with 14-05 running into 5 Dec morning if the review finds Highs).
