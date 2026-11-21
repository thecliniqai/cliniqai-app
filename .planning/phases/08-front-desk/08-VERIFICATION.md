# V2-08 Front desk: verification

Gate: **G4** (light, per PR). Approved under the PO's delegation of 2026-11-21 (`docs/v2/VERIFICATION_LOG.md`); the PO
reviews in the morning. All results below come from tool output in `evidence/`.

## Runs

| Run | Commit | Result | Source |
|---|---|---|---|
| Local evidence run (1 run, lean process) | `924d935fc55fbbaea016e95c05b83bee04051005` | Vitest 352 files, 7180/7180 passed, 0 skipped; pgTAP 55 files, 8321/8321, gate PASS; typecheck, eslint and inventory exit 0; static checks: 0 P1-34 boundary messages, 0 UTC-today messages, service-role factory only `lib/supabase/system.ts` | `evidence/summary.json`, `full-run-1.json`, `pgtap-run-1.tap`, `static-checks.json` |
| CI run [44874140074](https://github.com/thecliniqai/cliniqai-app/actions/runs/44874140074) | `924d935` | **Red**: e2e failed. iphone-15 `shell/clinic-switcher.spec.ts:60` failed 3 of 3 (also red at `2967c33`, run 44864640479); desktop `clinic-switcher.spec.ts:109` passed only on retry. Root causes and fix below | GitHub run log |
| CI run (fix and these docs) | PR #14 head (`5e9177c` plus the gate-docs commit) | Recorded with the gate decision below, from `phase-evidence.mjs --ci-run`; written in the first commit of the V2-09a branch so the merge needs no extra CI run | `evidence/ci-run.json` |

`dirty_worktree: true` in `summary.json` refers only to untracked files outside the phase (`docs/live-roadmap.html`,
`docs/whatsapp-templates-v2.md`, `.planning/debug/`, the V2-09a plan); no tracked file differed.

### CI 44874140074 root causes (fixed in `5e9177c`)

1. **iphone-15, hard fail since 08-05:** the spec read the cookie lifetime from the browser jar. WebKit on Linux stores at
   most 365 days (the received value was 365.0), so 400 days could not be proven there. The app was correct (Max-Age 400 days).
   The spec now asserts `Max-Age=34560000` on the response's Set-Cookie, joining the values because WebKit splits the header at
   the comma of `Expires`, and keeps a 364-day floor on the jar. It passed 3 devices × 3 repeats locally with no retries.
2. **desktop flake (product gap):** the shell's session-status watch signed the device out while the test navigated to
   `/today`. The dashboard layout's `getUser()` still saw the user, but `getActiveMembership()`'s did not, and the layout
   rethrew `UnauthenticatedError` to the route error page instead of sending the user to /login. The layout now redirects as
   the wrapped pages do. The new Vitest case in `tests/auth/active-clinic-removed-db.spec.ts` fails without the fix.

The `✘` marks on `security/network-block.spec.ts` and `m0/consult-rx-finish.spec.ts` are declared expected failures
(`test.fail()`; `knownBug("P1-03")`, closed by V2-09a), not failures of the run.

## Acceptance (roadmap §12 V2-08, mapping in `08-PLAN.md`)

| Criterion | Evidence | Result |
|---|---|---|
| M4 1 functional parity | v1 behaviour inventories in `08-NOTES.md` (08-03a, 08-04b), each row with a test or an approved removal; M0 specs rewritten with unchanged outcome assertions | **Met** |
| M4 2 interaction targets | `ux` counts in the Today, walk-in, booking and reschedule specs (check-in 1; walk-in existing 3 keystrokes; booking with context 3, without 4; reschedule 4) | **Met** |
| M4 3 accessibility | `tests/e2e/a11y/front-desk-screens.spec.ts` axe 0 serious/critical at 360, 820, 1280; keyboard-only walk-in and booking specs. TalkBack/VoiceOver: PO device run (08-P2) | **Met** (device part pending PO) |
| M4 4 responsive | PR lane on desktop-chrome, pixel-7, iphone-15; no horizontal scroll checks; tablet structure assertions | **Met** |
| M4 5 resilience | spec 7 (`pwa/13-idempotent-retry.spec.ts`) walk-in and booking legs: commit, abort, retry, exactly one row | **Met** |
| M4 6 performance | Realtime update within 2 s in the two-context spec; `/today` first-load JS from `ci:route-js` in the CI build job | **Met** |
| M4 7 data integrity | `tests/ci/no-client-command-chains.spec.ts`; direct table writes revoked (08-06a S-1, S-2, S-8, pgTAP `front_desk_review_fixes`) | **Met** |
| M4 8 observability | `loading.tsx` on new routes; route boundary reports render errors; `callCommand` logs failures by tag | **Met** |
| Two-tenant Realtime isolation | `tests/realtime/today-signals.spec.ts`; S-7 row-topic check (pgTAP) | **Met** |
| Overbook path creates exactly one patient | `book-appointment` e2e plus `register_and_book` DB test | **Met** |
| Slots correct with device TZ UTC | `shell/clinic-zone-hydration.spec.ts` (UTC and New York), slot adapter specs, pgTAP across the IST date line | **Met** |
| Receptionist can register a patient (PO-3) | journey 3 as receptionist, `register-patient-rpc.spec.ts` | **Met** |
| Timed-out walk-in retried with the same id creates one visit | spec 7 walk-in leg, `walk-in-rpc.spec.ts` replay | **Met** |
| Tablet layout at 744, 820, 1180 | PR-lane structural assertions and `evidence/screens`; PO sees the same set in `08-PO-WALKTHROUGH.md` (08-P3) | **Met** (PO walkthrough pending) |
| Journeys 3, 4, 5; state-machine and slot tests | e2e journey specs; pgTAP `visit_state_machine`, `staff_scheduling`; Vitest parity and slot specs | **Met** |
| V2-07 backlog (F-9, G-3, floor) | 08-01a, 08-04a | **Met** |
| Latency condition on definer commands | `evidence/command-latency.json`: every command p95 ≤ 8 ms locally (target 150 ms), `passed: true` | **Met** |

## Reviews

| Review | Scope | Result |
|---|---|---|
| Isolated reviewer (Sonnet) | whole phase | No Critical; 1 High (A-1 vitals overwrite), 4 Medium, 5 Low (`08-REVIEW-A.md`) |
| Adversarial security reviewer (Opus) | whole phase | No Critical/High and no cross-tenant path; 4 Medium, 4 Low, 4 hardening (`08-REVIEW-SEC.md`) |
| Fix round 08-06a | every "Fix" row | Fixed; per-row commits and tests in `08-REVIEW-TRIAGE.md` "08-06a outcome". Deferred: A-9 (V2-11), S-10, S-11, purge cap (V2-14) |

## PO items (morning)

1. **08-P2** device run (`08-DEVICE-CHECKLIST.md`) and **08-P3** walkthrough (`08-PO-WALKTHROUGH.md`).
2. **08-P4** staging: apply migrations 000100–000106 and turn hosted Realtime "Allow public access" off.
3. Confirm the A-10 reading (a late no-show shows in Booked, then Waiting after check-in) and the Q-1…Q-10 defaults in `08-PLAN.md`.

## Gate decision (2026-11-21)

Recorded after the CI run of the PR head (see Runs): in the V2-09a branch's first commit, with the merge commit SHA.
