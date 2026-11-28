# V2-15 notes: docs and runbook lane (15a)

Branch `v2/phase-15a-runbooks`, written 2026-11-28 by Claude under the PO's delegation (deadline 6 Dec 2026). Scope of
this lane: only the documentation and the two scripts that need no database. Decisions applied: CTO-1 (G6 restore
drill on the synthetic post-bootstrap dump; later monthly drills on an ephemeral encrypted AWS `ap-south-1` host),
CTO-2 (names-only secret inventory run by the PO), D-1 (Resend through UAT, SES after go-live).

## Done in this lane

| Plan | File | Notes |
|---|---|---|
| 15-02 | `docs/runbooks/razorpay-live.md` | live keys, plan, webhook check, Rs 5 tests, `uat` redemption, comp fallback |
| 15-02 | `docs/runbooks/email-production.md` | Resend domain, key, hook at `/api/auth/send-email`, verify |
| 15-02 | `docs/runbooks/platform-admin-bootstrap.md` | identity, two factors, break-glass drill |
| 15-02 | `docs/ops/secret-rotation.md` (appended section) | pre-filled production checklist |
| 15-02 | `scripts/prod/secret-inventory.mjs` | names only; refuses `NAME=value` and dotenv-style paths; fixed reason codes only; eslint clean |
| 15-02 | `15-LIVE-PAYMENTS-CHECKLIST.md` | PO fills ids and dates |
| 15-03 | `docs/runbooks/incident.md` | roles, severity, containment, CERT-In 6 h and DPDP templates |
| 15-03 | `docs/runbooks/alerts.md` (alert drill), `docs/runbooks/uptime.md` | drill steps match the planned `alert-drill.mjs --print` |
| 15-03 | `public/.well-known/security.txt` | placeholders (`REPLACE-ME`); the readiness check must fail while they remain |
| 15-04 | `docs/runbooks/free-tier-upgrade.md`, `uat.md`, `uat-slip.md`, `restore-drill.md`, `restore-drill-aws.md` | |
| 15-06 | `docs/release-notes/v2.0.md`, `docs/uat/{campaign-guide,tester-guide,invite-email,invite-whatsapp}.md` | draft; Known gaps filled from evidence later |
| 15-06 | `15-DEVICE-RUN.md` | R1 to R15 with steps and expected results, plus four production extras |
| 15-06 | `scripts/prod/g6-checklist.mjs` | parses roadmap 17.1, maps each line to kind, runbook, verify command; no DB; a line is done only with `--ci-run` (code kind) or the PO's pasted verification; refuses secret-looking text; eslint clean |
| all | `.planning/PO-ACTIONS.md` section 6 | ordered external steps |

## Left (not in this lane)

- **15-01**: `lib/env.ts` production tier, `scripts/prod/check-readiness.mjs` and checks, `production-migrate.yml`,
  `docs/runbooks/{production-setup.md,production-bootstrap.sql,production-migrate.md}`, migration 000205, tests.
  The runbooks written here reference `production-bootstrap.sql` and `production-setup.md`; both must exist before G6.
  The readiness check must also fail while `public/.well-known/security.txt` contains `REPLACE-ME`.
- **15-02 code**: `verify-webhook-delivery.mjs`, `verify-email.mjs` and their unit tests (parsers, secret-shaped
  input refused). `razorpay-live.md` has placeholders for the billing webhook path and the webhook-events table; fill
  from the merged V2-13b names. Same for `platform.*` comp-grant and cancel RPC names used in `uat-slip.md`
  (it points at `subscriptions-sql.md`, which is the source).
- **15-03 code**: `/api/ready` provider checks and rate limit, `scripts/prod/realtime-sizing.mjs`,
  `scripts/ops/alert-drill.mjs`, tests. Confirm `/.well-known/security.txt` is served (middleware matcher, headers).
- **15-04 code**: `ops/backup/production/*` (AWS template), merge `docs/ops/{backup-restore,backup-aws-golive}.md` into one
  runbook with a production section (the restore-drill runbooks point at it), `scripts/ops/restore-drill.mjs --local`,
  restore-drill test.
- **15-05**: k6, LHCI blocking, route-JS budgets (not touched).
- **15-06 code/DB**: `uat-campaign.sql` and any migration 000206, in-app `/help` page and e2e test, generated
  `G6-CHECKLIST.md` (run the generator at close with the CI run id).
- Close: reviews, evidence, VERIFICATION, roadmap status.

## Caveats for the reviewer

- Several runbook SQL snippets use placeholders for table and column names that only exist after V2-13b/13c merges;
  they are marked and point to `docs/runbooks/subscriptions-sql.md` as the source. Verify against the merged
  migrations.
- The CERT-In and DPDP texts are operational aids from public knowledge, not legal advice; the PO confirms the current
  channel and Rules text (flagged in the runbook).
- Nothing here ran against a hosted system, the local stack, or any secret.
