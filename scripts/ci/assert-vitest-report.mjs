#!/usr/bin/env node
/**
 * Vitest report gate (V2-02 plan 02-01 step 3; roadmap V2-02 acceptance "0 skipped in the DB lane"; G3).
 *
 * Reads the JSON written by `vitest run --reporter=json --outputFile=<file>` and fails when
 *   - the run did not succeed, or any test file did not pass (includes files that failed to import);
 *   - any test failed;
 *   - any test is skipped, pending or todo (`it.skip`, `describe.skip`, `it.todo`, `skipIf` that fired, a filtered
 *     `.only` run) — the DB lane must run everything;
 *   - the total test count is below the floor (a silently shrinking suite, e.g. a glob or config change);
 *   - (V2-02 02-06, IR-F5) a required security spec file is missing or has no passed test: the floor alone would let
 *     a whole spec vanish.
 *
 * FLOOR rule (IR-F5): at least 95% of the measured suite, so a drop of more than ~5% fails.
 * FLOOR history (update in the same commit that legitimately removes tests, with the arithmetic):
 *   1100 — V2-02 02-01 (full suite at 60d8db0 had 1128 tests).
 *   1100 — V2-02 02-04, unchanged: −13 deleted (T-12: cabin/navigation-roles 5, queue/status-actions 5,
 *          ops/backup-restore 3), +1 (the one real case from navigation-roles moved to settings/profile-and-credentials),
 *          +1 visit-history and +1 clinic-visits-register (mock "isolation" cases rewritten as DB cases, dual-tenant
 *          user added), +7 tests/ci/doc-grep-gate, +3 tests/ci/tests-typecheck = net 0.
 *   1805 — V2-02 02-06 (IR-F5): the full suite at 21eff42 had 1885 tests, +14 in the 02-06 CI-hardening commit
 *          (known-bug-match 3, ci-scripts 6, vitest-report-gate 2, playwright-summary 1, audit-gate 1,
 *          test-env-guard 1) = 1899; 1899 × 0.95 = 1804.05 → 1805.
 *   3292 — V2-03 phase close: the full suite at 570a82d (code at e4eb4c1) had 3465 tests in 162 files, 0 skipped;
 *          3465 × 0.95 = 3291.75 → 3292. REQUIRED_FILES gains every spec V2-03 added outside tests/e2e (60 files; 69 in total).
 *   4180 — V2-04 phase close: the full suite at fceeda2 (I-1 fix included) had 4399 tests in 211 files, 0 skipped;
 *          4399 × 0.95 = 4179.05 → 4180. No test was removed by a V2-04 rewrite without its replacement in the same run
 *          (the count is the measured total). REQUIRED_FILES gains every spec V2-04 added outside tests/e2e (49 files;
 *          118 in total).
 *   4633 — V2-05 05a gate close: the full suite at 13217bb (000078, the 05a fixes and gates) had 4876 tests in 248 files,
 *          0 skipped; 4876 × 0.95 = 4632.2 → 4633. REQUIRED_FILES gains every spec 05a added outside tests/e2e
 *          (37 files; 155 in total).
 *   4804 — V2-05 05-10b (05b wave 9): the full suite at the 05-10b tree had 5056 tests in 256 files, 0 skipped;
 *          5056 × 0.95 = 4803.2 → 4804. REQUIRED_FILES gains every spec 05b added so far outside tests/e2e (7 files; 162
 *          in total).
 *   4810 — V2-05 05-10c (05b wave 10): the full suite at the 05-10c tree had 5063 tests in 257 files, 0 skipped;
 *          5063 × 0.95 = 4809.85 → 4810. REQUIRED_FILES + tests/ai/ai-reserve-concurrency.spec.ts (163 in total).
 *   4823 — V2-05 05-12 (05b review fixes): the full suite at the 05-12 tree had 5076 tests in 258 files, 0 skipped;
 *          5076 × 0.95 = 4822.2 → 4823. REQUIRED_FILES + tests/staff/reinvite-role.spec.ts (164 in total).
 *   4826 — V2-05 05b gate close (000094): the full suite at the gate tree has 5080 tests in 260 files, 0 skipped (5076 + the
 *          4 tests of the two new specs; measured by both evidence runs in evidence/05b/summary.json);
 *          5080 × 0.95 = 4826. REQUIRED_FILES gains every remaining spec 05b added or rewrote for its own acceptance
 *          (tests/helpers/subscription.spec.ts, the rewritten tests/integration/subscription.spec.ts, auth/invite,
 *          cross-tenant, share-path-encoding, invite-token-lockout, msg91-webhook) and the two gate-close specs
 *          (ai-commit-expiry-race, invite-dedupe-role): 173 in total.
 *   5872 — V2-06 06-08 (phase close step 1): the full suite at the 06-08 tree (000094, branch and stack matching) had
 *          6181 tests in 300 files, 0 skipped (evidence/06-08/vitest-full-summary.txt); 6181 × 0.95 = 5871.95 → 5872.
 *          REQUIRED_FILES gains every spec V2-06 added outside tests/e2e (40 files; 213 in total).
 *   5909 — V2-06 06-09c (Wave B review fixes): the full suite at the 06-09c tree (000094) had 6219 tests in 303 files,
 *          0 skipped (evidence/06-09c/vitest-full-summary.txt); 6219 × 0.95 = 5908.05 → 5909. REQUIRED_FILES + the three
 *          new 06-09c specs (auth-outage-db, active-clinic-removed-db, record-layouts-db; 216 in total).
 *   5974 — V2-06 06-09d (re-verification fixes): the full suite at the 06-09d tree (c68851a, stack 000094) had 6288
 *          tests in 305 files, 0 skipped (evidence/06-09d/vitest-full-summary.txt); 6288 × 0.95 = 5973.6 → 5974.
 *          REQUIRED_FILES + the two new 06-09d specs (auth-failure, session-auth-reverify-db; 218 in total).
 *   5985 — V2-06 gate close: the full suite at the gate-close tree (5197b1a + this commit's REQUIRED_FILES line, stack
 *          000094) had 6300 tests in 306 files, 0 skipped (evidence/close/vitest-full-measure.txt); 6300 × 0.95 = 5985.
 *          REQUIRED_FILES + tests/auth/session-auth-close-db.spec.ts (219 in total). tests/ci/vitest-report-gate.spec.ts
 *          follows the default (it still named 5909: b11e398 raised the FLOOR without it, so that spec failed from
 *          b11e398 on; fixed here).
 *   5992 — V2-06 06-09e (G3 design review fixes): the full suite at the 06-09e tree (2a23550 + this commit's
 *          REQUIRED_FILES line, stack 000094) had 6307 tests in 307 files, 0 skipped
 *          (evidence/06-09e/vitest-full-summary.txt); 6307 × 0.95 = 5991.65 → 5992. REQUIRED_FILES +
 *          tests/design/design-review-09e.spec.ts (220 in total).
 *   6385 — V2-08 08-01a (R-3, the V2-07 backlog item "re-measure the floor"): the full suite at the V2-07 merge tree
 *          (9ce25d7 + the V2-08 plan docs, stack 000099) had 6721 tests in 320 files, 0 skipped, matching the V2-07
 *          evidence run; 6721 × 0.95 = 6384.95 → 6385. (The report held 5 failed tests: 4 in tests/commands/use-command.spec.ts,
 *          which ran against this plan's in-progress runner change, and 1 random-hex collision in tests/labs/lab-storage-key.spec.ts,
 *          both fixed in the same plan; the count is what the floor uses.) V2-07 added no spec outside tests/e2e that
 *          REQUIRED_FILES lacks (checked against the V2-06 head d86b332: 13 files, all present). REQUIRED_FILES + the two
 *          08-01a specs (tests/commands/save-state.spec.ts, tests/staff/doctor-picker.spec.ts; 235 in total).
 *   6385 — V2-08 08-01b, unchanged: REQUIRED_FILES + the three 08-01b specs (tests/queue/start-consultation-rpc.spec.ts,
 *          tests/queue/complete-visit-rpc.spec.ts, tests/visits/state-machine.spec.ts; 238 in total). The floor is re-measured at
 *          the next gate; the suite only grew.
 *   6385 — V2-08 08-02, unchanged: REQUIRED_FILES + the four 08-02 specs (tests/patients/search-patients-db.spec.ts,
 *          search-route.spec.ts, find-duplicates-db.spec.ts, register-patient-rpc.spec.ts; 242 in total). The patient specs
 *          that tested the removed select-star search (10 cases) went with it; the suite grew by 45.
 *   6385 — V2-08 08-03a, unchanged: REQUIRED_FILES + the seven 08-03a specs (tests/realtime/today-signals.spec.ts,
 *          tests/today/{get-today-board,live,announcer,schema}.spec.ts, tests/pwa/safe-refresh.spec.ts,
 *          tests/supabase/realtime-token.spec.ts; 249 in total). The floor is re-measured at the next gate; the suite only grew.
 *   6385 — V2-08 08-03b, unchanged: REQUIRED_FILES + the three 08-03b specs (tests/today/{modes,shortcuts}.spec.ts,
 *          tests/ci/no-client-command-chains.spec.ts; 252 in total). The floor is re-measured at the next gate; the suite only
 *          grew (one `getQueueForDate` guard case went with that function).
 *   6385 — V2-08 08-04a, unchanged: REQUIRED_FILES + the five 08-04a specs (tests/visits/{reschedule-visit-rpc,cancel-visit-rpc,
 *          no-show-confirm-rpc}.spec.ts, tests/waitlist/waitlist-commands-rpc.spec.ts, tests/scheduling/patient-reschedule.spec.ts;
 *          257 in total). The floor is re-measured at the next gate; the suite grew (the mock-based confirmAppointment cases and
 *          two raw-error cases went with the deleted services).
 *   6385 — V2-08 08-04b, unchanged: REQUIRED_FILES + the two 08-04b specs (tests/schedule/{slot-adapter,schedule-model}.spec.ts; 259
 *          in total). The floor is re-measured at the next gate; the suite grew.
 *   6455 — V2-08 08-05: 6385 + 70 new tests = 6455 (tests/visits/{suggest-slots 15, slot-suggestion-context-db 6,
 *          slot-assist-entitlement-db 4}.spec.ts, tests/patients/duplicate-rules-db.spec.ts 28, tests/clinics/switch-clinic-db.spec.ts 11,
 *          and the guard suite's legs for the two new actions switchClinic and getSlotAssist: 6); REQUIRED_FILES + the five new specs
 *          (264 in total). The floor is re-measured at the next gate; the suite grew.
 *   6455 — V2-08 08-06a, unchanged: REQUIRED_FILES + tests/visits/record-vitals-merge.spec.ts (6) and
 *          tests/security/front-desk-direct-writes.spec.ts (10), minus tests/visits/create-visit-slot-race.spec.ts (8, the retired
 *          `createVisit` service; its replacements are cases in the booking and walk-in command specs). A full run at the close of the
 *          round had 7180 tests in 352 files, 0 skipped (265 required files); the floor is re-measured at the next gate.
 *   6455 — V2-09a 09A-01, unchanged: REQUIRED_FILES + tests/clinical/seal-system-path.spec.ts (3) and
 *          tests/consultation/record-state-parity.spec.ts (3). The suite only grew (two cases in tests/api/v1-doctor-guard.spec.ts); the
 *          floor is re-measured once at the phase close (09A plan, R-18).
 *   6455 — V2-09a 09A-02, unchanged: REQUIRED_FILES + tests/consultation/rx-seal.spec.ts (10) and
 *          tests/security/ac6-rewrite-signed-rx.spec.ts (9). The floor is re-measured once at the phase close.
 *   6455 — V2-09a 09A-03, unchanged: REQUIRED_FILES + tests/prescriptions/rx-pdf-archive.spec.ts (15). The suite only grew (ac6-rewrite-signed-rx.spec.ts
 *          +7 storage cases, storage-provider.spec.ts +1, rx-seal.spec.ts +1); the floor is re-measured once at the phase close.
 *   6455 — V2-09a 09A-04, unchanged: REQUIRED_FILES + tests/labs/lab-documents-append-only.spec.ts (11). The suite lost the two deleteLabDocument cases of
 *          review2-fixes-db.spec.ts (rewritten as one) and the delete case of no-raw-error-logging.spec.ts (replaced) and no-raw-error-responses.spec.ts (-1);
 *          the floor is re-measured once at the phase close.
 *   6455 — V2-09a 09A-05, unchanged: REQUIRED_FILES + tests/consultation/workspace-sealed.spec.ts (9) and
 *          tests/consultation/sealed-refusal-messages.spec.ts (9). The suite only grew; the floor is re-measured once at the phase close.
 *   6455 — V2-09a 09A-06a (review fix round), unchanged: REQUIRED_FILES + tests/prescriptions/rx-archive-signer.spec.ts (9) and
 *          tests/consultation/workspace-review-fixes.spec.ts (6). The suite only grew; the floor is re-measured once at the phase close.
 *   6455 — V2-09b 09B-01 (draft save model), unchanged: REQUIRED_FILES + tests/consultation/draft-save-rpc.spec.ts (36), draft-saver.spec.ts (26) and
 *          draft-rebase.spec.ts (28). The suite only grew; the floor is re-measured once at the phase close (09B-PLAN).
 *   6455 — V2-09b 09B-03 (tap-first entry), unchanged: REQUIRED_FILES + tests/consultation/exam-text.spec.ts (50), assist-ranking.spec.ts (25),
 *          catalogue.spec.ts (12) and assist-context-service.spec.ts (7). The suite only grew; the floor is re-measured once at the phase close.
 *   6455 — V2-09b 09B-04a (Smart Assist read side), unchanged: REQUIRED_FILES + tests/terminology/diagnosis-search.spec.ts (36), diagnosis-search-route.spec.ts (12)
 *          and tests/consultation/snapshot.spec.ts (14); assist-ranking.spec.ts gains 9 cases. Two cases of the deleted catch-up summary left
 *          tests/ai/prescription-suggestions.spec.ts and three cases (one per unconfigured provider) tests/security/ai-containment.spec.ts. The floor is re-measured once at the phase close.
 *   6455 — V2-09b 09B-04b (Smart Assist write side), unchanged: REQUIRED_FILES + tests/consultation/shorthand.spec.ts (80) and macros.spec.ts (14). The suite only grew;
 *          the floor is re-measured once at the phase close.
 *
 * Usage: node scripts/ci/assert-vitest-report.mjs <report.json> [--min-total <n>] [--require-files <a,b,…|none>]
 *   --require-files replaces REQUIRED_FILES (repo-relative paths); `none` disables the check (gate fixtures only).
 * Exit 0 = pass, 1 = gate failure, 2 = usage or unreadable report.
 */
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const FLOOR = 6455;

/** Security and acceptance specs that must be present with at least one passed test (IR-F5; V2-03 and V2-04 phase close). */
const REQUIRED_FILES = [
  "tests/security/guard-actions.spec.ts",
  "tests/security/guard-routes.spec.ts",
  "tests/security/guard-canary.spec.ts",
  "tests/security/p0-01-action-sweep.spec.ts",
  "tests/security/p0-01-forged-overrides.spec.ts",
  "tests/security/cross-tenant-refs.spec.ts",
  "tests/security/multi-clinic-tenant-filters.spec.ts",
  "tests/security/share-tokens.spec.ts",
  "tests/security/membership-guard.spec.ts",
  // V2-03 (03-PLAN.md "Phase close" step 1 plus each plan record's close note).
  // 03-01 env schema and boot; readiness probe; synthetic-phone guard (M-SEEDPHONE); env example.
  "tests/config/env-schema.spec.ts",
  "tests/config/env-boot.spec.ts",
  "tests/api/readiness-probe-db.spec.ts",
  "tests/ci/env-example.spec.ts",
  "tests/utils/synthetic-phones.spec.ts",
  "tests/messaging/provider-selection.spec.ts",
  // 03-02 / 03-04 service-role factory and boundary gates.
  "tests/security/system-db.spec.ts",
  "tests/storage/no-service-role-fallback.spec.ts",
  "tests/referrals/referral-source-clinics.spec.ts",
  "tests/security/p1-34-lint-gates.spec.ts",
  // 03-03 generated types, migration immutability, drift.
  "tests/ci/migration-immutability.spec.ts",
  "tests/ci/local-drift.spec.ts",
  "tests/ci/schema-snapshot.spec.ts",
  "tests/ci/hosted-dump-diff.spec.ts",
  // 03-05 clinic-timezone dates.
  "tests/utils/datetime.spec.ts",
  "tests/integration/ist-boundaries.spec.ts",
  // 03-06 proxy session.
  "tests/api/proxy-session.spec.ts",
  // 03-07 D1 spike.
  "tests/billing/record-payment-rpc.spec.ts",
  "tests/db/error-map.spec.ts",
  // 03-08 staging workflows and scripts.
  "tests/ci/workflow-policy.spec.ts",
  "tests/ci/staging-scripts.spec.ts",
  "tests/integration/demo-clinic-seed.spec.ts",
  // 03-09a/b/c logger, request id, error sink, sweep.
  "tests/observability/logger.spec.ts",
  "tests/observability/request-id.spec.ts",
  "tests/observability/scrub.spec.ts",
  "tests/observability/error-sink-db.spec.ts",
  "tests/observability/on-request-error.spec.ts",
  "tests/observability/diag-route.spec.ts",
  "tests/observability/no-raw-error-logging.spec.ts",
  // 03-10 SSRF.
  "tests/api/webhook-ssrf.spec.ts",
  // 03-11a auth config as code and drift.
  "tests/ci/auth-policy.spec.ts",
  "tests/ci/auth-config-hosted.spec.ts",
  "tests/integration/auth/auth-config-applied.spec.ts",
  // 03-11b Send Email hook and SES.
  "tests/auth/send-email-hook.spec.ts",
  "tests/auth/ses-sender.spec.ts",
  "tests/integration/auth/mailpit-sender.spec.ts",
  // 03-12a FT-05 password flows.
  "tests/auth/pwned.spec.ts",
  "tests/auth/password-service.spec.ts",
  "tests/integration/auth/change-password.spec.ts",
  "tests/integration/auth/reset-completion.spec.ts",
  // 03-12b sign-out and public paths.
  "tests/auth/public-paths.spec.ts",
  "tests/auth/signout-route.spec.ts",
  // 03-12c Turnstile, safe next, AUTH-00 re-check kit.
  "tests/auth/safe-next.spec.ts",
  "tests/auth/password-flows-captcha.spec.ts",
  "tests/integration/auth/auth00-recheck-kit.spec.ts",
  "tests/ci/auth00-recheck-cli.spec.ts",
  "tests/ci/recheck-args.spec.ts",
  // 03-13a…e review fixes.
  "tests/auth/session-age.spec.ts",
  "tests/api/proxy-matcher.spec.ts",
  "tests/billing/payment-actor-guards.spec.ts",
  "tests/observability/error-sink-scrub-db.spec.ts",
  "tests/api/v1-system-client-order.spec.ts",
  "tests/billing/billing-error-messages.spec.ts",
  "tests/observability/console-scrub.spec.ts",
  "tests/observability/sink-flood.spec.ts",
  "tests/api/webhook-dispatch-hardening.spec.ts",
  "tests/messaging/provider-timeouts-and-synthetic.spec.ts",
  "tests/security/no-raw-error-responses.spec.ts",
  "tests/auth/session-age-token-hook-db.spec.ts",
  "tests/integration/auth/session-age-token-hook.spec.ts",
  // V2-04 (04-PLAN.md "Phase close" step 1 plus each plan record's close note): every spec V2-04 added outside tests/e2e.
  // 04-00b Resend sender and the hook's Resend path.
  "tests/auth/resend-sender.spec.ts",
  "tests/auth/send-email-hook-resend.spec.ts",
  // 04-01 queue core: claim, grants, 8-runner exactly-once, reaper, runner library.
  "tests/jobs/claim-grants-db.spec.ts",
  "tests/jobs/parallel-dispatch-db.spec.ts",
  "tests/jobs/reaper-db.spec.ts",
  "tests/jobs/runner.spec.ts",
  // 04-02 scheduler, runner route and token auth.
  "tests/jobs/scheduler-migration-db.spec.ts",
  "tests/jobs/run-route.spec.ts",
  "tests/jobs/runner-auth.spec.ts",
  // 04-03a messages: enqueue RPC, handler, delivery reaper, MSG91 contract (MSW), sink, P0-12 lint gates.
  "tests/jobs/enqueue-message-rpc-db.spec.ts",
  "tests/jobs/message-send-handler-db.spec.ts",
  "tests/jobs/delivery-reap-db.spec.ts",
  "tests/messaging/msg91-contract.spec.ts",
  "tests/messaging/sink-provider.spec.ts",
  "tests/security/p0-12-lint-gates.spec.ts",
  "tests/setup/msw-loopback.spec.ts",
  // 04-03b webhooks: enqueue RPC and delivery handler.
  "tests/jobs/enqueue-webhook-rpc-db.spec.ts",
  "tests/jobs/webhook-deliver-handler-db.spec.ts",
  // 04-03c inbound idempotency, hook dedupe (ADR-0005 A3), contract grants, replay, backfill.
  "tests/messaging/inbound-dedupe-db.spec.ts",
  "tests/integration/auth/send-email-hook-dedupe-db.spec.ts",
  "tests/jobs/replay-job-db.spec.ts",
  "tests/jobs/queue-grants-db.spec.ts",
  "tests/jobs/backfill-db.spec.ts",
  // 04-04 alerts.
  "tests/jobs/alerts-db.spec.ts",
  "tests/jobs/alert-notify-db.spec.ts",
  "tests/jobs/alert-drill-db.spec.ts",
  "tests/jobs/alert-email.spec.ts",
  // 04-05a backup and restore drill.
  "tests/ops/backup-evidence.spec.ts",
  "tests/ops/backup-roundtrip-db.spec.ts",
  "tests/ops/backup-runs-db.spec.ts",
  "tests/ops/backup-script-guards.spec.ts",
  "tests/ops/drill-evidence-and-workflows.spec.ts",
  "tests/ops/drill-lib-db.spec.ts",
  "tests/ops/manifest-compare.spec.ts",
  "tests/ops/restore-drill-checks-db.spec.ts",
  // 04-06 heartbeat, quota, retention, ops report.
  "tests/ops/quota-level-db.spec.ts",
  "tests/ops/heartbeat-quota-db.spec.ts",
  "tests/ops/ops-cleanup-db.spec.ts",
  "tests/ops/ops-report-db.spec.ts",
  "tests/ops/check-ops-report.spec.ts",
  "tests/ops/quota-alert-email.spec.ts",
  // 04-07a…e review fixes (H-SMS, M-*, N-1/N-1b, N-2/N-2b, Lows, I-1).
  "tests/messaging/sms-recipient-exploit-db.spec.ts",
  "tests/messaging/inbound-retry-db.spec.ts",
  "tests/jobs/runner-review-fixes-db.spec.ts",
  "tests/jobs/alert-review-fixes-db.spec.ts",
  "tests/ops/ensure-schedules-db.spec.ts",
  "tests/ops/restore-guards.spec.ts",
  "tests/ops/manifest-guard.spec.ts",
  "tests/ops/restore-psql-restricted-db.spec.ts",
  // V2-05 05a (05-PLAN.md "05a gate" step 1 plus each plan record's close note): every spec 05a added outside tests/e2e.
  // 05-01a pgTAP harness and gate.
  "tests/ci/pgtap-report.spec.ts",
  "tests/ci/test-pgtap-script.spec.ts",
  "tests/ci/pgtap-legacy-inline.spec.ts",
  // 05-01b authz helpers, active-tenant carrier, parity, generated matrix.
  "tests/permissions/has-permission-parity.spec.ts",
  "tests/authz/active-tenant-carrier.spec.ts",
  "tests/authz/table-matrix.spec.ts",
  "tests/authz/generator-drift.spec.ts",
  // 05-03 composite FKs and diagnostics.
  "tests/ci/diagnostics-script.spec.ts",
  "tests/ci/fk-edge-cases-inline.spec.ts",
  // 05-04 delete paths.
  "tests/integration/delete-paths.spec.ts",
  // 05-02a clinical split.
  "tests/ci/clinical-notes-backfill-inline.spec.ts",
  "tests/security/role-rls.spec.ts",
  // 05-02b domain policies (acceptance 5) and billing:collect.
  "tests/patients/receptionist-registration.spec.ts",
  "tests/billing/collect-permission.spec.ts",
  // 05-02c storage, lab keys, audit v2.
  "tests/storage/storage-policies-jwt.spec.ts",
  "tests/labs/lab-storage-key.spec.ts",
  "tests/audit/audit-actor.spec.ts",
  // 05-06 exports and referrals.
  "tests/dpdp/export-dto.spec.ts",
  "tests/api/export-scope.spec.ts",
  // 05-08 integrity (acceptance 6 and 7).
  "tests/scheduling/no-double-booking.spec.ts",
  "tests/integration/queue-token-concurrency.spec.ts",
  "tests/api/v1-slot-conflict.spec.ts",
  // 05-11a…e review fixes (H-VISIT, H-INVITE, M-*, N-*, NF-*).
  "tests/visits/signed-visit-integrity.spec.ts",
  "tests/ci/visit-integrity-inline.spec.ts",
  "tests/visits/duration-bounds.spec.ts",
  "tests/billing/invoice-totals-db.spec.ts",
  "tests/audit/log-audit-allowlist.spec.ts",
  "tests/referrals/referral-consent-write.spec.ts",
  "tests/db/retry.spec.ts",
  "tests/scheduling/slot-deadlock-retry.spec.ts",
  "tests/api/v1-error-texts.spec.ts",
  "tests/api/v1-visits-no-clinical.spec.ts",
  "tests/api/v1-patients-no-clinical.spec.ts",
  "tests/dpdp/export-routes-audit.spec.ts",
  "tests/dpdp/export-fail-closed.spec.ts",
  "tests/auth/page-revoked-session.spec.ts",
  // 05b: 05-05 membership removal (acceptance 4); 05-07b invitations (acceptance 10), invite acceptance, Turnstile.
  "tests/integration/auth/remove-member.spec.ts",
  "tests/integration/auth/invite-delivery.spec.ts",
  "tests/integration/auth/accept-invite.spec.ts",
  "tests/jobs/email-invite-handler.spec.ts",
  "tests/auth/turnstile-verify.spec.ts",
  // 05-10a SUB-02 enforcement (acceptance 8 app half).
  "tests/subscriptions/lock-enforcement.spec.ts",
  // 05-10b layout redirects and locked/onboarding pages (SUB-02 UX).
  "tests/subscriptions/locked-redirects.spec.ts",
  // 05-10c AI-03 database part: the ai_reserve concurrency test (roadmap V2-05).
  "tests/ai/ai-reserve-concurrency.spec.ts",
  // 05-12 (M-REINVITE: a re-invite with another role yields the new role)
  "tests/staff/reinvite-role.spec.ts",
  // 05b gate close: the remaining specs 05b added or rewrote for its acceptance (05-09a subscription helper, 05-09c
  // rewritten subscription and cross-tenant specs, 05-07a invitations, 05-10a share links, 05-12 locked-clinic replies)
  // and the gate-close fixes (000094: re-verification N-1 and N-2).
  "tests/helpers/subscription.spec.ts",
  "tests/integration/subscription.spec.ts",
  "tests/security/cross-tenant.spec.ts",
  "tests/auth/invite.spec.ts",
  "tests/security/invite-token-lockout.spec.ts",
  "tests/security/share-path-encoding.spec.ts",
  "tests/messaging/msg91-webhook.spec.ts",
  "tests/ai/ai-commit-expiry-race.spec.ts",
  "tests/staff/invite-dedupe-role.spec.ts",
  // V2-06 (06-PLAN.md "Phase close" step 1, executed by 06-08): every spec V2-06 added outside tests/e2e.
  // 06-01a tokens, codemod, UI policy; 06-01b approved tokens, contrast, brand mark, AI labels; 06-02a… primitives.
  "tests/design/tokens.spec.ts",
  "tests/design/codemod.spec.ts",
  "tests/design/png-diff.spec.ts",
  "tests/design/approved-tokens.spec.ts",
  "tests/design/contrast.spec.ts",
  "tests/design/brand-mark.spec.ts",
  "tests/design/ai-labels.spec.ts",
  "tests/design/input-kind.spec.ts",
  "tests/design/gallery.spec.ts",
  "tests/design/age.spec.ts",
  "tests/ui/cn.spec.ts",
  "tests/utils/datetime-format.spec.ts",
  "tests/ci/ui-policy.spec.ts",
  "tests/ci/ui-policy-signout-guard.spec.ts",
  // 06-07 route-JS report and Lighthouse CI config (cookie scrub).
  "tests/ci/route-js.spec.ts",
  "tests/ci/lhci-config.spec.ts",
  // 06-04a client error capture (PHI); 06-09a client render events and route patterns.
  "tests/errors/client-error-kind.spec.ts",
  "tests/observability/client-error-action-db.spec.ts",
  "tests/observability/client-render-event.spec.ts",
  "tests/observability/client-routes.spec.ts",
  // 06-05 / 06-09a service worker allowlist, hard sign-out and purge, no-store, icons, device prefs.
  "tests/pwa/sw-allowlist.spec.ts",
  "tests/pwa/hard-sign-out.spec.ts",
  "tests/pwa/purge.spec.ts",
  "tests/pwa/auth-broadcast.spec.ts",
  "tests/pwa/proxy-no-store-db.spec.ts",
  "tests/pwa/device-prefs.spec.ts",
  "tests/pwa/online.spec.ts",
  "tests/pwa/icons.spec.ts",
  // 06-06 session status, lock, update, install.
  "tests/api/session-status-db.spec.ts",
  "tests/pwa/session-status.spec.ts",
  "tests/pwa/update.spec.ts",
  "tests/pwa/dirty-guard.spec.ts",
  "tests/pwa/platform.spec.ts",
  // 06-03a/b clinical status, vitals and Rx vocabulary.
  "tests/clinical/visit-status.spec.ts",
  "tests/clinical/vitals.spec.ts",
  "tests/clinical/rx.spec.ts",
  // 06-04b navigation by role, palette patient search (PHI projection), shell runtime.
  "tests/nav/nav-for-role.spec.ts",
  "tests/patients/palette-search-db.spec.ts",
  "tests/pwa/shell-runtime.spec.ts",
  // 06-08 React Compiler rules at error and their waiver register (R-30).
  "tests/ci/react-compiler-waivers.spec.ts",
  // 06-09c Wave B review fixes: an Auth outage is never a sign-out (H-AUTHOUT), removal from the active clinic
  // (M-REMOVED), record layouts tell a failed lookup from "not found" (IND L-2).
  "tests/auth/auth-outage-db.spec.ts",
  "tests/auth/active-clinic-removed-db.spec.ts",
  "tests/nav/record-layouts-db.spec.ts",
  // 06-09d re-verification fixes: a refresh/`/user` failure that is not a definitive GoTrue answer never signs out or
  // deletes cookies (H-AUTHOUT-R1, L-R1..L-R3); the device is pinned to its clinic (M-REMOVED-R1, L-R4).
  "tests/auth/auth-failure.spec.ts",
  "tests/auth/session-auth-reverify-db.spec.ts",
  // V2-06 gate close (the re-check's Lows L-N1, L-N2, L-N4: the Auth budget covers only session calls, the proxy's
  // 5.5 s budget, the pin expired on a definitive sign-out).
  "tests/auth/session-auth-close-db.spec.ts",
  // 06-09e (G3 design review): the BottomBar caption, palette shortcut label and initials mappings.
  "tests/design/design-review-09e.spec.ts",
  // V2-07 07-00 (command_claim/command_complete, the client command runner). The FLOOR is re-measured at the V2-07 gate.
  "tests/commands/command-results.spec.ts",
  "tests/commands/use-command.spec.ts",
  // V2-07 07-02 (create_invoice, collect_payment).
  "tests/billing/create-invoice-rpc.spec.ts",
  "tests/billing/collect-payment-rpc.spec.ts",
  // V2-07 07-01 (sign_consultation, reopen/finalize amendment, check_in_visit).
  "tests/consultation/sign-consultation-rpc.spec.ts",
  "tests/consultation/amendment-rpc.spec.ts",
  "tests/queue/check-in-rpc.spec.ts",
  // V2-07 07-03 (enqueue_walk_in, register_and_book, complete_and_bill, available_slots).
  "tests/queue/walk-in-rpc.spec.ts",
  "tests/visits/register-and-book-rpc.spec.ts",
  "tests/billing/complete-and-bill-rpc.spec.ts",
  "tests/scheduling/available-slots.spec.ts",
  // V2-07 07-04a (the review fix round): the booking message configuration fault and the overbook cause texts. The FLOOR is
  // re-measured at the V2-07 gate.
  "tests/visits/booking-template-fault.spec.ts",
  "tests/visits/slot-conflict-text.spec.ts",
  // V2-08 08-01a (useCommand SaveStatus mapping, doctor picker R-2).
  "tests/commands/save-state.spec.ts",
  "tests/staff/doctor-picker.spec.ts",
  // V2-08 08-01b (start_consultation, complete_visit, the visit state machine parity).
  "tests/queue/start-consultation-rpc.spec.ts",
  "tests/queue/complete-visit-rpc.spec.ts",
  "tests/visits/state-machine.spec.ts",
  // V2-08 08-02 (patient search, duplicate lookup and the registration command).
  "tests/patients/search-patients-db.spec.ts",
  "tests/patients/search-route.spec.ts",
  "tests/patients/find-duplicates-db.spec.ts",
  "tests/patients/register-patient-rpc.spec.ts",
  // V2-08 08-03a (Today's read model, live updates, the Realtime isolation spec, the safe refresh).
  "tests/realtime/today-signals.spec.ts",
  "tests/today/get-today-board.spec.ts",
  "tests/today/live.spec.ts",
  "tests/today/announcer.spec.ts",
  "tests/today/schema.spec.ts",
  "tests/today/modes.spec.ts",
  "tests/today/shortcuts.spec.ts",
  "tests/ci/no-client-command-chains.spec.ts",
  "tests/pwa/safe-refresh.spec.ts",
  "tests/supabase/realtime-token.spec.ts",
  // V2-08 08-04a (the staff scheduling commands and the patient's reschedule link).
  "tests/visits/reschedule-visit-rpc.spec.ts",
  "tests/visits/cancel-visit-rpc.spec.ts",
  "tests/visits/no-show-confirm-rpc.spec.ts",
  "tests/waitlist/waitlist-commands-rpc.spec.ts",
  "tests/scheduling/patient-reschedule.spec.ts",
  // V2-08 08-04b (the Schedule and the booking UIs).
  "tests/schedule/slot-adapter.spec.ts",
  "tests/schedule/schedule-model.spec.ts",
  // V2-08 08-05 (Smart Assist, the clinic switcher).
  "tests/visits/suggest-slots.spec.ts",
  "tests/visits/slot-suggestion-context-db.spec.ts",
  "tests/visits/slot-assist-entitlement-db.spec.ts",
  "tests/patients/duplicate-rules-db.spec.ts",
  "tests/clinics/switch-clinic-db.spec.ts",
  // V2-08 08-06a (the review fix round).
  "tests/visits/record-vitals-merge.spec.ts",
  "tests/security/front-desk-direct-writes.spec.ts",
  // V2-09a 09A-01 (the clinical seal).
  "tests/clinical/seal-system-path.spec.ts",
  "tests/consultation/record-state-parity.spec.ts",
  // V2-09a 09A-02 (the prescription seal and the AC-6 abuse spec).
  "tests/consultation/rx-seal.spec.ts",
  "tests/security/ac6-rewrite-signed-rx.spec.ts",
  "tests/prescriptions/rx-pdf-archive.spec.ts",
  "tests/labs/lab-documents-append-only.spec.ts",
  "tests/consultation/workspace-sealed.spec.ts",
  "tests/consultation/sealed-refusal-messages.spec.ts",
  // V2-09a 09A-06a (the review fix round: ruling R-A, the share-link hash, the 09A-05 UI rows).
  "tests/prescriptions/rx-archive-signer.spec.ts",
  "tests/consultation/workspace-review-fixes.spec.ts",
  // V2-09b 09B-01
  "tests/consultation/draft-save-rpc.spec.ts",
  "tests/consultation/draft-saver.spec.ts",
  "tests/consultation/draft-rebase.spec.ts",
  // V2-09b 09B-03
  "tests/consultation/exam-text.spec.ts",
  "tests/consultation/assist-ranking.spec.ts",
  "tests/consultation/catalogue.spec.ts",
  "tests/consultation/assist-context-service.spec.ts",
  // V2-09b 09B-04a
  "tests/terminology/diagnosis-search.spec.ts",
  "tests/terminology/diagnosis-search-route.spec.ts",
  "tests/consultation/snapshot.spec.ts",
  // V2-09b 09B-04b
  "tests/consultation/shorthand.spec.ts",
  "tests/consultation/macros.spec.ts",
];

const file = process.argv[2];
if (!file || file.startsWith("--")) {
  console.error("usage: node scripts/ci/assert-vitest-report.mjs <report.json> [--min-total <n>]");
  process.exit(2);
}
const minIdx = process.argv.indexOf("--min-total");
const floor = minIdx > -1 ? Number(process.argv[minIdx + 1]) : FLOOR;
if (!Number.isInteger(floor) || floor < 0) {
  console.error("vitest-report-gate: --min-total must be a non-negative integer");
  process.exit(2);
}
const reqIdx = process.argv.indexOf("--require-files");
const reqArg = reqIdx > -1 ? process.argv[reqIdx + 1] : undefined;
if (reqIdx > -1 && (reqArg === undefined || reqArg === "")) {
  console.error("vitest-report-gate: --require-files needs a comma-separated list or `none`");
  process.exit(2);
}
const required = reqArg === undefined ? REQUIRED_FILES : reqArg === "none" ? [] : reqArg.split(",").map((s) => s.trim());

let report;
try {
  report = JSON.parse(readFileSync(resolve(file), "utf8"));
} catch {
  console.error(`vitest-report-gate: cannot read a JSON report at ${file}`);
  process.exit(2);
}
if (!Array.isArray(report.testResults)) {
  console.error("vitest-report-gate: report has no testResults array (not a Vitest JSON report)");
  process.exit(2);
}

const cwd = process.cwd();
const short = (name) => (typeof name === "string" && name.startsWith(`${cwd}/`) ? relative(cwd, name) : name);
const problems = [];
const counts = { files: report.testResults.length, total: 0, passed: 0, failed: 0, skipped: 0 };

for (const f of report.testResults) {
  if (f.status !== "passed") problems.push(`file ${f.status ?? "unknown"}: ${short(f.name)}`);
  for (const t of f.assertionResults ?? []) {
    counts.total += 1;
    if (t.status === "passed") {
      counts.passed += 1;
    } else if (t.status === "failed") {
      counts.failed += 1;
      problems.push(`test failed: ${short(f.name)} > ${t.fullName ?? t.title}`);
    } else {
      counts.skipped += 1;
      problems.push(`test ${t.status ?? "not run"} (0 skipped allowed): ${short(f.name)} > ${t.fullName ?? t.title}`);
    }
  }
}

// The summary counters must agree with the per-test statuses (guards against a truncated or hand-edited report).
const pending = (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0);
if ((report.numFailedTests ?? 0) > 0 && counts.failed === 0) problems.push(`numFailedTests=${report.numFailedTests}`);
if (pending > 0 && counts.skipped === 0) problems.push(`numPendingTests+numTodoTests=${pending} (0 skipped allowed)`);
if ((report.numFailedTestSuites ?? 0) > 0 && !problems.some((p) => p.startsWith("file "))) {
  problems.push(`numFailedTestSuites=${report.numFailedTestSuites}`);
}
if (report.success !== true) problems.push(`success=${report.success}`);
if (counts.total < floor) problems.push(`total ${counts.total} is below the floor ${floor} (suite shrank?)`);
for (const req of required) {
  const file = report.testResults.find((f) => f.name === req || (typeof f.name === "string" && f.name.endsWith(`/${req}`)));
  const passed = (file?.assertionResults ?? []).filter((t) => t.status === "passed").length;
  if (!file) problems.push(`required spec file missing: ${req}`);
  else if (passed === 0) problems.push(`required spec file has no passed test: ${req}`);
}

console.log(
  `vitest-report-gate: files=${counts.files} tests=${counts.total} passed=${counts.passed} failed=${counts.failed} ` +
    `skipped/todo=${counts.skipped} floor=${floor} required=${required.length}`,
);
if (problems.length) {
  const shown = problems.slice(0, 200);
  for (const p of shown) console.error(`FAIL ${p}`);
  if (problems.length > shown.length) console.error(`FAIL ... and ${problems.length - shown.length} more`);
  process.exit(1);
}
console.log("vitest-report-gate: PASS");
