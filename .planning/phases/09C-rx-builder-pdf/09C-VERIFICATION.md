# V2-09c Rx builder & PDF: verification

Gate: **G4** (light, per PR). Approved under the PO's delegation of 2026-11-21. The delegation was for one night, and the
merge was the phase already in flight. The PO reviews it. Results below come from tool output in `evidence/` and the
linked CI runs.

## Runs

| Run | Commit | Result | Source |
|---|---|---|---|
| Local evidence run (1 run, lean process) | `9b56973e2db539aa655f1cf1c8ee92e278b7ab0d` | Vitest 393 files, 8029/8029, 0 skipped; pgTAP 69 files, 9025/9025, gate PASS; typecheck, eslint, inventory exit 0; static: 0 P1-34 boundary messages, 0 UTC-today messages, service-role factory only `lib/supabase/system.ts` | `evidence/summary.json`, `full-run-1.json`, `pgtap-run-1.tap`, `static-checks.json` |
| Earlier local run at `2e672ee5` | | Red: 1 case of `tests/realtime/today-signals.spec.ts` (Realtime event quota spent by the file before it). Root-caused and fixed in `93eae3ca` | `09C-NOTES.md` "today-signals flake" |
| CI [44996683003](https://github.com/thecliniqai/cliniqai-app/actions/runs/44996683003) | `9b56973e` | **Red** (e2e): `design/keyboard/clinical-b` asserted the pre-09C-02 allergy-reason message. Fixed in `34bb9eba` | GitHub run log |
| CI [45001844597](https://github.com/thecliniqai/cliniqai-app/actions/runs/45001844597) | `34bb9eba` | All jobs success, but **1 retried** (`pwa/13-idempotent-retry`: the `commitThenAbort` harness unrouted mid-handler). Not merged. Fixed in `08a51ee0` | GitHub run log |
| CI [45009571773](https://github.com/thecliniqai/cliniqai-app/actions/runs/45009571773) | `08a51ee06682361dc36c845058b24680f8e9e318` (PR head) | static, security, test, build, e2e all success; pgTAP 69 files, 9025, gate PASS; e2e **0 retried** (only expected failures: the declared `network-block` cases) | `evidence/ci-run.json`, `ci-pgtap-report.tap` |

The commits after the local evidence run (`9b56973e..08a51ee0`) are test-only: one spec assertion and the shared e2e
harness. Product code is unchanged. The CI run at the PR head covers them.

## Acceptance

Each criterion maps to `09C-PLAN.md`; the test names per plan are in `09C-NOTES.md`.

| Area | Evidence | Result |
|---|---|---|
| Rx lines through one definer command; direct DML revoked; never invents a dose | pgTAP `rx_lines_command`; Vitest `change-prescription-rpc`; e2e `rx-keyboard`, journey 6 (Rx leg 0 clicks) | **Met** |
| Medicine search route; specials and wildcards safe; p95 under 50 ms | pgTAP `rx_lines_command`; Vitest `medicine-search-route`; p95 35.9 ms | **Met** |
| Allergy check at the DB (exact substance OR name), override reason, three allergy states | pgTAP `rx_allergy_check`, `rx_review_fixes`; Vitest `allergy-match`; e2e `rx-allergy`, `finish-review` | **Met** |
| Own-doctor favourites, "your usual", "Same as last visit"; allergy matches never copied silently (SA-02) | pgTAP `rx_assist`; Vitest `rx-favourites-db`, `repeat-visit-plan-rpc`; e2e `rx-assist` | **Met** |
| PDF: A4/A5, letterhead and margins, clinic zone, no default timing, no patient name in the file name, deterministic bytes, print stylesheet (Q-2) | Vitest `rx-golden`, `rx-pdf-content`, `rx-print-settings`; e2e `rx-print` | **Met** |
| Finish review, Share PDF, print from the success screen; WhatsApp not preselected (Q-8) | e2e `finish-review`, `rx-share`; Vitest `complete-and-bill-rpc` | **Met** |
| Camera capture, compression to 1 MB or less, metadata stripped | Vitest `compress-image`; e2e `capture-compress` (desktop, pixel-7, iphone-15) | **Met** |
| Keyboard and tap budgets; axe 0 serious/critical at 360, 820, 1180, 1280 | e2e journey 6, `keyboard-golden`, `consult-screens`, `rx-assist` | **Met** (device run pending PO, 09C-P2) |
| Latency (commands under 150 ms, reads under 50 ms) | `09C-NOTES.md`: `change_prescription` 4.7, `record_patient_allergies` 3.6, `repeat_visit_plan` 9.4, `rx_allergy_context` 9.1, `search_medicines` 35.9 ms p95 | **Met** |
| Route JS budget (report-only) | `/consultation/[id]` 387.7 kB gz against 200 kB | **Not met, report-only**: V2-14 row stands |

## Reviews

| Review | Result |
|---|---|
| Isolated (Sonnet), whole phase | No Critical; 1 High (A-1, a lost-response line not reconciled), 8 Medium, 11 Low (`09C-REVIEW-A.md`) |
| Adversarial (Opus), whole phase | No Critical or High; 2 Medium (S-1 a forged brand id bypasses the allergy check, S-2 allergy writes outside the command go unaudited), 4 Low, 3 Hardening (`09C-REVIEW-SEC.md`) |
| Fix round 09C-06a (Opus) | All 18 Fix rows fixed, each with a fails-without test. Exceptions: the tile half of A-12 and the hook half of A-2. Migration 000120. S-3 and T-09C-13 accepted as AR-09C-01/02, owner V2-12 (`09C-REVIEW-TRIAGE.md`, `09C-SECURITY.md`) |

## PO items

1. **09C-P1:** gate review. Confirm:
   - AR-09C-01: the v1 API Rx writer skips the allergy check until V2-12.
   - AR-09C-02: no rate limit on the new routes.
   - R-W: WhatsApp at sign is now opt-in. It was previously automatic for the Rx and receipt links. Reverting is one line (`features/billing/service.ts`).
2. **09C-P2:** the device run (`09C-DEVICE-CHECKLIST.md`). **09C-P3:** the walkthrough (`09C-PO-WALKTHROUGH.md`).
3. **09C-P4:** staging, after 09B-P4. Apply 000117–000120. The `search_medicines` function settings need Postgres 15 or later.
4. **09C-P5:** reload the CDCI data with the medicine-to-substance mapping (`substance_ids`). Until then, CDCI lines are checked by name only.
5. **09C-P6:** acknowledge rulings Q-2 (print stylesheet kept), Q-8 (WhatsApp not preselected) and Q-9 (product line kept, plus "Rx v{n} · Page x of y").
6. **09C-P7:** Today's live board can go silently stale for about a minute when the project's Realtime event quota trips, for example on a bulk write. Decide on a slow refresh while live (V2-14).

## Gate decision (2026-11-22)

Approved by Claude as CTO delegate (CI green, 0 retried). PR #17 merged into `feature/v2` with a merge commit,
`7160fc13638dee8bf7fb500959b868514b492d5c`. Staging migrations were not touched. V2-10 has not started; it waits for
the PO.
