# V2-07 Atomic server commands: verification

Gate: **G4** (light, per PR). PO approves. All results below come from tool output in `evidence/`.

## Runs

| Run | Commit | Result | Source |
|---|---|---|---|
| Local evidence run (1 run, lean process) | `9b79e9110687bb15f5d9e0668371eb047359336d` | Vitest 320 files, 6721/6721 passed, 0 skipped; pgTAP 49 files, 8083/8083, gate PASS; typecheck, eslint and inventory exit 0; static checks: 0 P1-34 boundary messages, 0 UTC-today messages, service-role factory only `lib/supabase/system.ts` | `evidence/summary.json`, `full-run-1.json`, `pgtap-run-1.tap`, `static-checks.json` |
| CI run [44760574035](https://github.com/thecliniqai/cliniqai-app/actions/runs/44760574035) | `9b79e9110687bb15f5d9e0668371eb047359336d` | static, security, test, build and e2e all success; pgTAP 49 files, 8083 tests, 0 failed; e2e 629 passed, 233 skipped by project filters, **0 retried** | `evidence/ci-run.json`, `ci-pgtap-report.tap`; e2e job summary "Retried to pass (flaky): 0" |

`dirty_worktree: true` in `summary.json` refers only to two untracked PO files outside the phase
(`docs/live-roadmap.html`, `docs/whatsapp-templates-v2.md`); no tracked file differed.

## Acceptance (roadmap §12 V2-07)

| # | Criterion | Evidence | Result |
|---|---|---|---|
| 1 | Fault injection after step 1 persists nothing | A scoped fault (`tests/helpers/fault.ts`) per command: create_invoice, collect_payment, sign_consultation, reopen/finalize amendment, check_in_visit, enqueue_walk_in, register_and_book, complete_and_bill; each asserts no rows, no audit, no outbox, no claim | **Met** |
| 2 | Double-submit produces one record | A replay case per command (`replayed: true`, row counts unchanged) and mismatch cases (`IDEMPOTENCY_MISMATCH`, every hashed input varied after T-1/G-7); concurrent duplicate claim in `tests/commands/command-results.spec.ts` | **Met** |
| 3 | Concurrency tests pass | Concurrent collects on one visit (one invoice, payments capped); two sign-offs of one visit (one signature); parallel check-ins (distinct tokens); concurrent bookings of one slot (one visit, `SLOT_TAKEN`, no orphan patient) | **Met** |
| 4 | Audit and outbox rows exist only for committed commands | Happy-path cases assert the audit and outbox rows; fault cases assert none. The command-only audit actions are no longer writable through `log_audit` (F-1, pgTAP) | **Met** |
| 5 | PWA-06a: `client_request_id` on every write RPC | `expectCommandCatalog` (command form needs a required `p_client_request_id uuid`) on every V2-07 command; actions validate it as a uuid | **Met** (client retry/SaveStatus UX is PWA-06b, V2-08) |
| 6 | Branch hook (PO 2026-11-15, ruling 2026-11-18) | `clinic_locations.test.sql`: one default per clinic, new clinics get one, visits/queue tokens/invoices get a same-clinic `location_id`, cross-clinic refused; `location_id` frozen on signed visits (F-3) | **Met** |
| 7 | P1-04 in-transaction audit | Commands write audit inside the transaction (`private.log_command_audit`); the replaced app-side `recordAudit` calls are deleted | **Met** |
| 8 | V2-03 spike gaps closed | `payments` INSERT and `invoices` UPDATE revoked (V2-05); **`invoices` INSERT revoked from `authenticated` (000099, pgTAP)**; Sign & Bill runs sign + invoice + payment as one command | **Met** |
| 9 | e2e on the device matrix | CI e2e: desktop, Pixel 7, iPhone 15, iPadOS PWA; 629 passed, 0 retried | **Met** |
| 10 | Migration rollback tested locally | Each migration (000095–000099) applied by `supabase db reset --local` in every plan and in the evidence run; expand-only except the `location_id` NOT NULL on dev data (no live data, PO-15) and the grants narrowed in 000099 | **Met** (forward-only; no production data exists) |

## Reviews

| Review | Scope | Result |
|---|---|---|
| Isolated reviewer (Sonnet), round 1 | 07-00, 07-02, 07-01 | No High; 4 Medium, 5 Low |
| Adversarial security reviewer (Opus), round 1 | 07-00, 07-02, 07-01 | No Critical/High; 2 Medium, 3 Low, 1 hardening |
| Isolated reviewer (Sonnet) | 07-03 | No High; 2 Medium, 5 Low |
| Adversarial security reviewer (Opus) | 07-03 | No Critical/High/Medium; 3 Low/hardening |
| Fix round 07-04a | all rows marked "Fix 07-04a" | Fixed; mapping per row in `07-REVIEW-TRIAGE.md` "07-04a outcome". No High existed, so no re-check round (lean process) |

## Pending PO decisions (gate)

1. **Definer commands** (TARGET §7.1 erratum 2026-11-20, VERIFICATION_LOG): approve that the atomic commands are `SECURITY DEFINER` with the fixed guard block.
2. **Sign only after check-in** (F-6): sign-off now requires `waiting` or `in_consultation`. The calendar's "Start Consultation" on booked/confirmed visits needs a check-in first. Recommendation: keep the rule; in V2-08 "Start Consultation" checks the patient in.
3. **Visit doctor = owner or doctor** (G-9): an admin with credentials is refused as a visit's doctor but still listed by the staff doctor picker. Recommendation: drop them from the picker in V2-08.
4. **Invoice line cap ₹10,00,000** (F-8): raise if any procedure can cost more.
