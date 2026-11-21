# V2-09b Consult workspace: verification

Gate: **G4** (light, per PR). Approved under the PO's delegation of 2026-11-21; the PO reviews in the morning. Results
below come from tool output in `evidence/` and the CI runs linked.

## Runs

| Run | Commit | Result | Source |
|---|---|---|---|
| Local evidence run (1 run, lean process) | `199c0db2f4e6fe1f228ea8d57b678fdc7c79b2ca` | Vitest 378 files, 7690/7690, 0 skipped; pgTAP 65 files, 8824/8824, gate PASS; typecheck, eslint, inventory exit 0; static: 0 P1-34 boundary messages, 0 UTC-today messages, service-role factory only `lib/supabase/system.ts` | `evidence/summary.json`, `full-run-1.json`, `pgtap-run-1.tap`, `static-checks.json` |
| Earlier local run at `fbb22a17` | | Red: `tests/dpdp/export-dto.spec.ts` setup refused by the new S-2 trigger (fixture attached a document after sign-off; its 3 cases were skipped). Fixed in `199c0db` | run log |
| CI [44924479177](https://github.com/thecliniqai/cliniqai-app/actions/runs/44924479177) | `199c0db` | **Red** (e2e): 3 hard failures, 4 retried-to-pass, lane cut at its 40-minute limit. Root causes below | GitHub run log |
| CI [44942218223](https://github.com/thecliniqai/cliniqai-app/actions/runs/44942218223) | `3a01bc0` | **Red** (e2e): 1 hard failure on iphone-15 (`today-live` 2 s case); 0 retried-to-pass | GitHub run log |
| CI [44953316569](https://github.com/thecliniqai/cliniqai-app/actions/runs/44953316569) | `7e807d1f250ae902e7cc03b06c4225980d87bd1c` (PR head) | static, security, test, build, e2e all success; pgTAP 65 files, 8824, gate PASS; e2e **0 retried** (only `✘`: the declared `network-block` expected failures) | `evidence/ci-run.json`, `ci-pgtap-report.tap` |

Commits after the local evidence run (`199c0db..7e807d1`) are the CI root-cause fixes: two product fixes (Quick OPD chips
deduped against learned tiles; the unload guard set with the edit), test isolation (own doctor, own clinic), stale
selectors, and the e2e lane time limit. Each is covered by the CI run at the PR head and by the local full PR-lane runs
recorded in `09B-NOTES.md` ("CI 44924479177 root causes", "CI 44942218223").

### CI root causes (detail in `09B-NOTES.md`)

1. `shell/nav-per-role`: waited for the v1 `section#vitals` (test).
2. `smart-assist` Today, `tap-entry` learned order, `keyboard-golden`: projects shared one doctor (test isolation).
3. `m0/consult-rx-finish` pixel-7: the same diagnosis offered twice (product; fixed).
4. `draft-persistence` killed tab: the test closed the page normally, which saves on purpose (test now crashes the renderer).
5. `draft-persistence` unload guard: listener registered one render late (product; fixed).
6. `schedule:277` whole-time match and `clinic-zone-hydration` hidden streamed copy (latent test defects).
7. Lane cut at 40 minutes; then `today-live` 2 s on iphone-15 rendering a 400-visit shared day (test now owns its clinic).
   Lane limit 85 minutes, job 95 (CTO delegate; sharding is a PO decision).

## Acceptance

Mapping per criterion in `09B-PLAN.md` "Acceptance mapping"; test names per plan in `09B-NOTES.md`.

| Area | Evidence | Result |
|---|---|---|
| Draft save, one atomic command, conflict-safe, flushed on leave (R-4) | pgTAP `consult_draft_save`, `consult_review_fixes`; e2e `draft-persistence`, `review-fixes` A-1 | **Met** |
| Workspace layout at 360, 820, 1180, 1280 | e2e `workspace-layout`, `tablet-captures`; axe `consult-screens` | **Met** |
| Tap-first entry (3 complaints ≤ 3 taps, 0 typed; template 3 taps; follow-up 1 tap) | e2e `tap-entry` with the `ux` counter | **Met** |
| Smart Assist context limited to the doctor's own signed visits | pgTAP `consult_assist_context` (29); Vitest `assist-context-service` | **Met** |
| Diagnosis search (abbreviations, typo, custom first) on a GET route | pgTAP `diagnosis_search_snapshot`; Vitest `diagnosis-search`, `diagnosis-search-route`; e2e `smart-assist` | **Met** |
| Deterministic patient snapshot replaces the LLM catch-up | Vitest `snapshot`; e2e `smart-assist` | **Met** |
| Shorthand and private macros | Vitest `shorthand` (81), `macros`; pgTAP `doctor_text_macros` (46) | **Met** |
| Follow-up booking from consult and Today | e2e `smart-assist` | **Met** |
| Lab upload drop zone | e2e `upload`, Vitest `file-drop`, `lab-upload-review-fixes`; pgTAP S-2 | **Met at 4 MB** (R-U; 25 MB is a PO decision) |
| Journey 6 on three devices, keyboard-only, axe 0 serious/critical | e2e journey 6, `keyboard-golden`, a11y specs | **Met** (device run pending PO, 09B-P2) |
| Everything works with AI off | e2e `smart-assist` (all `ai_features` off) | **Met** |
| Latency of new reads (target 50 ms) | `09B-NOTES.md`: `consult_assist_context` p95 9.2 ms, `search_diagnoses` 39.3 ms, `patient_snapshot` 3.6 ms; `save_consultation_draft` 3.1 ms | **Met** |
| Route JS budget (report-only) | `/consultation/[id]` 368 kB gz against 200 kB | **Not met, report-only**: V2-14 backlog |

## Reviews

| Review | Result |
|---|---|
| Isolated (Sonnet), whole phase | No Critical; 2 High (A-1 lost edits on navigation, A-2 template overwrite), 3 Medium, 4 Low (`09B-REVIEW-A.md`) |
| Adversarial (Opus), whole phase | No Critical/High, no cross-tenant path; 2 Medium (S-1 body limit, S-2 uploads on signed visits), 2 Low, 3 Hardening (`09B-REVIEW-SEC.md`) |
| Fix round 09B-06a | Every Fix row fixed with a measured fails-without test; S-3 deferred to V2-14; A-9, S-5 accepted (`09B-REVIEW-TRIAGE.md`) |

## PO items

1. **09B-P1** gate review; decide R-U (25 MB uploads need direct-to-Storage upload, an architecture change).
2. **09B-P2** device run (`09B-DEVICE-CHECKLIST.md`) and **09B-P3** walkthrough (`09B-PO-WALKTHROUGH.md`).
3. **09B-P4** staging: apply 000112–000116; before 000112, check for duplicate follow-ups per visit (query in `09B-NOTES.md`).
4. **09B-P5** CI: the e2e lane now has an 85-minute limit; decide on sharding it.

## Gate decision (2026-11-22)

Approved by Claude as CTO delegate under the PO's delegation of 2026-11-21 (CI green, 0 retried). PR #16 merged into
`feature/v2` with a merge commit, `02b2f49eb3e15c889576930608e813af238320a2`. Staging migrations were not touched.
