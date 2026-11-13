---
phase: 03
roadmap_id: V2-03
status: awaiting PO gate approval (G3-partial)
verified_commit: 2e6f3c2 (local evidence; evidence/commit.txt)
ci_run: evidence/ci-run.json (run 43368090792 at 2da3fec — five jobs success, Playwright 188 passed, 0 retried, gitleaks clean)
---

# Phase 03 (V2-03) — verification

Every figure comes from a tool output:
- `scripts/phase-evidence.mjs`: the Vitest JSON reporter, tsc, ESLint, the inventory and the ESLint-computed P1-34 counters.
- `scripts/ci/assert-vitest-report.mjs`: the report gate.
- `scripts/ci/playwright-summary.mjs`: the Playwright lane summary.
- `scripts/ci/local-drift.mjs`, `scripts/drift/schema-snapshot.mjs`, `scripts/ops/export-error-events.mjs` and `check-error-export.mjs`.
- `scripts/ci/package-legitimacy.mjs`.
- `scripts/phase-evidence.mjs --ci-run <id>` for the GitHub Actions run (the orchestrator fills `ci_run`).

Nothing is hand-typed from a run. Local stack only. `supabase db reset --local` ran before the evidence.

| File | Content |
|---|---|
| `evidence/commit.txt`, `summary.json`, `full-run-{1,2}.json`, `static-checks.json` | Two consecutive full Vitest runs and the static checks at `2e6f3c2` (clean tree outside `.planning`) |
| `evidence/close/` | Phase-close tool outputs at `2e6f3c2`: `typecheck.txt`, `eslint.txt`, `inventory.txt`, `ai-l1.txt`, `audit.txt`, `vitest-report-gate.txt`, `local-drift.txt`, `schema-snapshot-check.txt`, `types-freshness.txt`, `e2e-build.txt`, `e2e-pr.txt`, `playwright-summary.txt`, `error-events-export.txt`, `package-legitimacy.txt`, `event-names.{sh,txt}`, `sha-map.txt`, `lowfix-regression.txt` |
| `evidence/playwright-results.json` | Playwright PR lane JSON report (desktop-chrome, Pixel 7, iPhone 15) |
| `evidence/b1/` | Local drift (`local-drift.{json,txt}`, regenerated at close, unchanged) and the local dump round trip. The hosted report waits on 03-E1a |
| `evidence/error-events-export.json` | Local `ops.error_events` export of the e2e diag error (1 row, check OK) |
| `evidence/package-legitimacy.json` | `plans.03-11b`, `plans.03-12c` and `plans.phase-close`: every lockfile entry V2-03 added or re-versioned since `e66edf9` (87) |
| `evidence/03-*/` | Per-plan evidence, including the 03-06 before/after outputs and the 03-13a…e without-fix / with-fix runs |

Local results at `2e6f3c2`:
- **Vitest:** 162 files / 3465 tests, passed in both runs, 0 failed, 0 skipped. Teardown left nothing behind.
- **Report gate:** PASS for both runs (floor 3292, 69 required files).
- **Static checks:** typecheck exit 0; `eslint . --quiet` exit 0 (`npx eslint .`: 0 errors, 422 warnings); inventory exit 0 (0 flagged). `ci:ai-l1` PASS. `ci:audit` PASS (two allowlisted highs, owner V2-12 P1-19, expiry 2027-02-10).
- **Playwright PR lane:** 188 expected (including 10 KNOWN-BUG expected failures), 7 skipped by design, 0 unexpected, 0 flaky, 0 retried.

## Acceptance (roadmap §12.2 V2-03, mapping in `03-PLAN.md` "Acceptance mapping (roadmap V2-03, binding)")
| # | Criterion | Evidence (tool output) | Result |
|---|---|---|---|
| 1 | production boot fails without real providers | `tests/config/env-schema.spec.ts` 178/178 and `env-boot.spec.ts` 10/10 passed (`full-run-{1,2}.json`); H-ENV re-verified CLOSED (`reviews/v203-review-high-reverify.md`) | Met locally; Vercel build with `APP_ENV=staging` **pending PO (03-E4)** |
| 2 | 1 service-role factory; 0 imports outside allow-list + register; bypass fixtures fail lint | `static-checks.json`: `service_role_factories` = `["lib/supabase/system.ts"]`, `p1_34_boundary_messages` 0, every `boundary_messages` id 0, `boundary_directives` [], 313 files linted; `tests/security/p1-34-lint-gates.spec.ts` 131/131 (fixtures incl. `raw-stream.ts`) | Met |
| 3 | fresh `db reset` matches the target schema (drift = 0 or documented) | `evidence/b1/local-drift.json` and `close/local-drift.txt`: PASS, 1 statement, the documented pg_net line allowlisted, 0 drift; `close/schema-snapshot-check.txt` PASS (2210 lines equal the committed snapshot) | Local met; hosted B1 report **pending PO (03-E1a)** |
| 4 | `tsc` passes with generated types | `static-checks.json` `typecheck` exit 0; `close/types-freshness.txt` (`npm run db:types` then `git diff --exit-code`) exit 0 | Met |
| 5 | 0 UTC "today" sites | `static-checks.json` `utc_today_messages` 0; `tests/utils/datetime.spec.ts` 17/17, `tests/integration/ist-boundaries.spec.ts` 4/4 | Met |
| 6 | spike report: RLS, `auth.uid()` actor, audit + outbox in one transaction | `tests/billing/record-payment-rpc.spec.ts` 36/36; `03-07-D1-SPIKE.md` (C18 confirmed); H-PAY re-verified CLOSED | Met |
| 7 | staging deploys from CI | `tests/ci/workflow-policy.spec.ts` 33/33, `tests/ci/staging-scripts.spec.ts` 52/52; `staging.yml` / `drift.yml` in the repo | Code met; first approved `staging.yml` run + Vercel deploy link **pending PO (03-E1b, 03-E2, 03-E4, 03-E10)**, post-merge (R-19) |
| 8 | thrown server error in the India-resident sink, PII scrubbed | e2e `observability/error-sink.spec.ts` passed (desktop-chrome 2; pixel-7 skipped by design); `evidence/error-events-export.json` + `close/error-events-export.txt` (1 row, allowed columns only, no PII pattern); `tests/observability/scrub.spec.ts` 146/146, `error-sink-db.spec.ts` 27/27, `console-scrub.spec.ts` 6/6; H-LOG re-verified CLOSED | Local met; staging diag error + export check **pending PO (03-E9, 03-E4)** |
| 9 | staging sends a password-reset code through SES with DKIM passing | `tests/auth/send-email-hook.spec.ts` 28/28, `ses-sender.spec.ts` 7/7, `tests/integration/auth/mailpit-sender.spec.ts` 7/7; e2e `auth/send-email-hook.spec.ts` passed (desktop-chrome 2) | Code met; reset mail with `dkim=pass` **pending PO (03-E0, 03-E5, 03-E6, 03-E8, 03-E4)** |
| 10 | Turnstile on sign-in and reset | e2e `auth/turnstile.spec.ts` passed (desktop-chrome 6, pixel-7 6), `auth/j-a3-login.spec.ts` (4 + 4), `a11y/turnstile-screens.spec.ts` (8); `tests/auth/password-flows-captcha.spec.ts` 14/14 | Local met; live widget + `captcha_failed` without a token **pending PO (03-E7, 03-E3)** |
| 11 | `POST /auth/signout` clears the session server-side + `Clear-Site-Data: "cache"` | e2e `auth/signout.spec.ts` passed (desktop-chrome 6, pixel-7 3; 3 pixel-7 skips by design); `tests/auth/signout-route.spec.ts` 21/21 | Met |
| 12 | auth config drift check green | `tests/ci/auth-policy.spec.ts` 14/14 (the `static` policy check), `tests/ci/auth-config-hosted.spec.ts` 11/11, `tests/integration/auth/auth-config-applied.spec.ts` 6/6 | Local met; hosted `drift.yml` `auth-config` green **pending PO (03-E3, 03-E10, 03-E11)** |
| 13 | Pwned password rejected by change-password and reset actions (FT-05) | `tests/auth/pwned.spec.ts` 13/13, `tests/integration/auth/change-password.spec.ts` 6/6, `reset-completion.spec.ts` 5/5; e2e `auth/j-a4-reset.spec.ts` and `j-a5-change-password.spec.ts` passed (desktop-chrome, pixel-7) | Met locally; real-API check on staging **pending PO (03-E4)** |
| 14 | staging functions in `bom1`, or deviation recorded | `tests/ci/staging-scripts.spec.ts` 52/52 (region check), `tests/api/health-probes.spec.ts` 13/13 (`/api/health` region); `vercel.json` pins `bom1` | Code met; `/api/health` `region` on staging **pending PO (03-E4)** |

Roadmap tests:
- unit: all plans
- IST 00:00–05:30 boundaries: `ist-boundaries.spec.ts`
- env-schema boot: `env-boot.spec.ts`
- spike DB integration incl. rollback: `record-payment-rpc.spec.ts`
- scrubber: `scrub.spec.ts`
- FT-05 hit/miss/down with a mocked range API: `pwned.spec.ts`

Scope items without an acceptance row:
- P2-01: Next 16.4.6, `static-checks.json` `dependencies`; `03-06-NEXT16.md`; PO confirms at 03-E15.
- P1-43: no `@aws-sdk/client-s3`.
- P2-03: SSRF resolver; `tests/api/webhook-ssrf.spec.ts`.
- P1-25 logger and request ids: `logger.spec.ts`, `request-id.spec.ts`; e2e `security/request-id.spec.ts`.
- OA-5 default deny: `tests/auth/public-paths.spec.ts` 61/61; e2e `security/unauth-pages.spec.ts` 21 + 21.
- AUTH-00 re-check kit: `tests/integration/auth/auth00-recheck-kit.spec.ts` 14/14; the hosted run is pending PO.

## Reviews (CLAUDE.md DoD 6) — reports in `reviews/`
| Range | Reviewer | Severity (C/H/M/L/I) | Outcome |
|---|---|---|---|
| `origin/feature/v2..3f81bfb` | Independent | 0/1/2/9/8 | Fixed in 03-13a…d (triage) |
| same | Adversarial A env/staging | 0/1/6/9/6 | H-ENV and the Mediums fixed in 03-13b. Seven Lows open without an owner (`03-SUMMARY.md`) |
| same | Adversarial B service role/DB | 0/1/4/6/4 | H-PAY and the Mediums fixed in 03-13c |
| same | Adversarial C logging/PII | 0/1/3/5/5 | H-LOG and the Mediums fixed in 03-13d |
| same | Adversarial D auth/session | 0/1/2/5/5 | H-AUTH fixed in 03-13a and 03-13e. M-OTP (R-36) and M-EMAILCAP fixed |
| same | Adversarial E SSRF | 0/0/3/5/4 | M-XTENANT-WH, M-SSRF-V6 and M-SSRF-DNS fixed in 03-13d |
| `14e0811` | Fresh High re-verification | 4 Highs CLOSED; 1 new Low | Low fixed in `e4eb4c1` (console `dir`/`dirxml`/`table` + raw-stream lint gate). H-AUTH on hosted needs 03-E3 |

Accepted items (reason and owner) are in `03-13-REVIEW-TRIAGE.md`.

Every fix has a regression test that fails without it. The without-fix runs are in `evidence/03-13{a..e}/`. For the
phase-close Low, `evidence/close/lowfix-regression.txt` ran the console-scrub and P1-34 lint-gate specs with
`lib/observability/console-scrub.ts` and `eslint.config.mjs` swapped back to `e4eb4c1^`: 5 failed, 132 passed (the
`dir`/`dirxml`/`table` case and the four `raw-stream.ts` failing-path cases). With the fix: 137 passed.

No test was retried to green. Both Vitest runs and the Playwright lane ran with `retries: 0` locally and show 0 flaky
results.

## Not yet verifiable (owner)
- The hosted halves of acceptance 1, 3, 7, 8, 9, 10, 12, 13 and 14 are pending the PO actions named in the table. They close after merge (R-19). Claude runs each verify command and updates this file and VERIFICATION_LOG.
- CI run on the verified commit: the orchestrator records it with `scripts/phase-evidence.mjs --ci-run <id>` and fills `ci_run`.
- Merge blockers: 03-E13 (rulings incl. R-9, R-35, R-36), 03-E14 (two flagged packages), 03-E15 (Next 16 outcome).
