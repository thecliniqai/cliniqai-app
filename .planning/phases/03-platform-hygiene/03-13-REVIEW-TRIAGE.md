# 03-13 Review triage (V2-03)

Reviewed commit `3f81bfb` (CI run 43352282789 green, 0 retried). Six fresh reviewers; reports in `reviews/`:
`v203-review-independent.md` (IND), `…-adversarial-env-staging.md` (A), `…-service-role-db.md` (B), `…-logging-pii.md` (C),
`…-auth-session.md` (D), `…-ssrf.md` (E). Triage by the orchestrator acting as CTO; the PO confirms at the gate (E13).

Rule: every **fix** lands with a regression test that fails without it. **High** items get a fresh re-verification
review after the fix. **Accepted** items carry a reason and an owner phase.

## Highs (all fixed in 03-13; re-verified)

| ID | Source | Finding | Fix | Plan |
|---|---|---|---|---|
| H-AUTH | IND H-1, D H-1 | Emailed-code (recovery/invite/OTP) sessions can change the password through GoTrue `PUT /auth/v1/user` at any age, skipping current password, the 10-min bound and FT-05. App-only bound. | Proxy ends any emailed-code session whose code sign-in is older than 600 s (fail closed on unknown `amr` methods). Reset completion signs the recovery session out and sends the user to sign in with the new password (**ruling R-35**). Test drives the direct GoTrue call after 600 s and after reset. | 03-13a |
| H-ENV | A H-1 | Staging/production accept a secret key (`sb_secret_` or `service_role` JWT) in `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (and the reverse swap). | Schema refuses by prefix and by decoded JWT role in both directions, every tier. | 03-13b |
| H-LOG | C H-1 (IND/03-09b residual) | Next.js prints uncaught server errors (message, stack, PostgREST `details` such as `Key (phone)=…`) to stderr → Vercel logs, bypassing the scrubber. | `register()` wraps `console.error`/`console.warn` so Error-like arguments pass through the scrubber; e2e asserts the server's stderr for a planted phone/email error contains neither. | 03-13d |
| H-PAY | B H-1 | Any staff member can `INSERT` into `payments` via PostgREST with a forged `recorded_by`, any amount/command id; `record_payment` then replays the forged row. | Migration: BEFORE INSERT trigger forces `recorded_by := auth.uid()` and `recorded_by_system := false` for non-system callers; replay returns only rows recorded through the RPC by the same actor. Overpayment via direct insert stays with V2-07 (contract step). | 03-13c |

## Mediums

| ID | Source | Decision | Plan |
|---|---|---|---|
| M-PROBE | A M-2, B M-1, B Low | Fix: `readiness_probe` returns booleans only (no cross-tenant counts, no migration version to anon), indexed bounded check; execute limited as needed by `/api/ready`. | 03-13c |
| M-GUARD | A M-1 | Fix: staging target guard rejects any DB-URL query parameter outside an allow-list (`host`, `user`, `sslmode≠require` refused). | 03-13b |
| M-POLICY | A M-3, IND Low | Fix: `workflow-policy.mjs` enforces every rule its headers claim (no `pull_request*`/`workflow_run` triggers on staging/drift, no `write-all`, no `github.head_ref`/untrusted contexts in `run:`, no npm cache in privileged jobs). | 03-13b |
| M-PREVIEW | A M-4 | Fix: with `APP_ENV=staging` the app refuses to boot unless `VERCEL_ENV` is `production` (or absent off-Vercel); PO-ACTIONS 03-E4 adds "staging secrets scoped to Production only". | 03-13b |
| M-SEEDPHONE | A M-5 | Fix: seeded phones use a range the messaging layer refuses to send to (synthetic-number guard) on every tier. | 03-13b |
| M-TOKEN | A M-6 | Doc: 03-E11 fallback stated (if no scoped read-only token exists, the drift job runs in `staging` with approval rather than an account-wide token in `staging-readonly`). | 03-13b |
| M-OTP | D M-1 | Fix: OTP length 8 (config as code + 03-E3; **ruling R-36**). Per-account verify limiter → V2-13b (owner) with the signup rework. | 03-13a |
| M-EMAILCAP | D M-2 | Fix: reset page shows "try again later" on the rate-limit code instead of success; AUTH-00 kit gains the hook-vs-cap probe. | 03-13a |
| M-LOGFIELDS | C M-1 | Fix: `reason`/`action`/`module`/`route` typed as closed unions or validated patterns; free text rejected. | 03-13d |
| M-SCRUB | C M-2, B Low, C Low | Fix: app and DB scrubbers share one pattern list: spaced/dashed Indian mobiles, dashed Aadhaar, `@abdm`-style addresses, unicode emails, expression-index keys, multi-line `Failing row`, digit-free tokens, `sb_secret_`/`sb_publishable_`; scrub `error_name`/`error_code`; truncate after scrub. | 03-13d (app) + 03-13c (DB) |
| M-ERRMSG | C M-3, 03-09c note | Fix: server actions/routes stop returning raw `err.message` (DB errors, storage paths with patient names) — map to catalogue codes via one helper; `features/auth/**` already done in 03-12a. | 03-13d |
| M-AUDITSYS | B M-2 | Fix: trigger forces `actor_type = 'user'` and `actor_id = auth.uid()` for non-system writers of `audit_logs`. | 03-13c |
| M-LINT | B M-3, IND Low | Fix: ban `new SupabaseClient`, `GoTrueAdminApi`, `@supabase/postgrest-js`, `@supabase/ssr/dist/**` subpaths, `require`/`module.require` forms, string-built secret env names; inline `eslint-disable` of boundary rules fails CI (counted in evidence). | 03-13c |
| M-ALLOWLIST | B M-4 | Fix: factory import allowed only in `lib/jobs/internal/**` (not all of `lib/jobs/**`); app code may not import `scripts/`, `docs/`, `lint-fixtures/`. `lib/webhooks/**`, `lib/api/**` stay on the ADR-0005 register until V2-04/P1-37. | 03-13c |
| M-XTENANT-WH | E-1 | Fix: dispatcher refuses a queue row whose subscription tenant ≠ row tenant (test proves the forged row is not sent). Composite FK → V2-05 P1-02; revoke of direct queue writes → V2-04 (enqueue RPC). | 03-13d |
| M-SSRF-V6 | E-3, IND M-1 | Fix: byte-level IP classification incl. IPv4-compatible/mapped, NAT64 (both prefixes), 6to4, Teredo, site-local, discard-only, 198.18/15, 192.0.0/24, 192.88.99/24; normalise DNS answers. | 03-13d |
| M-SSRF-DNS | E-2, IND M-1 | Fix: pin the checked address — connect-time lookup in an undici dispatcher re-validates every resolved address (closes rebinding); test ping rate-limited. | 03-13d |
| M-DRIFT | IND M-2 | Fix: hosted drift covers `public`, `ops`, `private` and privileges; the CI local-drift step compares a fresh reset against a committed schema snapshot (not migrations against themselves). | 03-13b |

## Lows fixed in 03-13 (cheap, with tests)

03-13a: `next` may not target `/api/**`; proxy matcher no longer skips image-extension paths for pages (default-deny and request id); sign-out with an expired token tested; Send Email hook dedupes on `webhook-id` and its SES budget is below GoTrue's hook timeout.
03-13b: migration-immutability gate also runs on pushes to `feature/v2`; CI fails when two branches use the same migration number against `origin/feature/v2`.
03-13c: `record_payment` outbox check works inside a savepoint; `/api/v1` authenticates before taking the system client; DB ingest truncates after scrubbing.
03-13d: timeouts on MSG91/Gupshup/Twilio/AI fetches; webhook URL redacted (path/query) in audit rows; owner retry limit capped; error-sink per-fingerprint flood bound.

## Accepted (reason, owner)

| Item | Reason | Owner |
|---|---|---|
| Unlimited current-password guessing with a stolen session (D L-1) | Needs a stolen session; bounded by GoTrue rate limits; per-account limiter lands with the auth limiter work | V2-13b |
| Hook failure reveals account existence during an email outage (D L-3) | Outage-only side channel; signups are off | V2-13b |
| Staging can serve new code against the old schema until the PO approves `migrate` (IND Low) | By design (R-9 approval); runbook orders migrate before promote | V2-04 runbook |
| Lab storage keys contain patient names (IND Low) | Key scheme change touches every stored document | V2-05 (storage policies) |
| Overpayment / status change via direct table writes | Contract step | V2-07 |
| H-AUTH residual: an access token minted just before the 600 s bound stays valid at GoTrue until ~1,500 s after the code (03-13e) | Bounded ≤ 25 min; refresh refused by the token hook; the proxy ends the session on first app request; cutting `exp` broke GoTrue's reported expiry | V2-13b (session time-box on Pro or a shorter JWT expiry review) |

## New rulings (PO confirms with E13)

- **R-35** Password reset ends **signed out**: after setting the new password the recovery session is revoked and the user signs
  in with the new password. Deviates from AUTH_REDESIGN (reset ends signed in). Reason: an emailed-code session must not
  outlive its purpose (H-AUTH); industry default (e.g. most identity providers require a fresh sign-in after reset).
- **R-36** Email OTP length 8 (was 6). Reason: D M-1 brute-force math; no UX cost beyond two digits.
