---
phase: 02
roadmap_id: V2-02
status: awaiting PO gate approval (G3-partial)
verified_commit: 5076e1b (CI run 43296726451: five jobs green, Playwright 122 passed, 0 retried)
ci_run: evidence/ci-run.json
---

# Phase 02 (V2-02) — verification

Every figure is tool output: `scripts/phase-evidence.mjs` (Vitest JSON reporter, tsc, ESLint, inventory) for the local
runs, `scripts/phase-evidence.mjs --ci-run <id>` for the GitHub Actions run (URL, head SHA, per-job conclusions),
`gh api` responses for repository settings, and `scripts/m0-baseline-report.mjs` for the M0 appendix. Nothing is
hand-typed from a run.

| File | Content |
|---|---|
| `evidence/ci-run.json` | The CI run on the verified commit: five jobs (`static`, `security`, `test`, `build`, `e2e`) |
| `evidence/02-01/ci-run.json` | First green CI run (02-01) |
| `evidence/summary.json`, `full-run-{1,2}.json`, `commit.txt`, `static-checks.json` | Two consecutive local full runs on the verified commit |
| `evidence/m0-baseline/` | M0 baseline (generated at `ade531f`): flow results, interaction counts, route JS, axe ×3 devices, 69 screenshots at 360/768/1280 |
| `evidence/github-settings/` | Before/after responses for every repository setting changed |

## Acceptance (roadmap §12.2 V2-02, verbatim)
| Criterion | Evidence | Result |
|---|---|---|
| the PR lane is green with 0 skipped in the DB lane | `evidence/ci-run.json` (all five jobs `success`); the `test` job's report gate fails on any skipped/todo test and on a missing security spec; local `evidence/summary.json` 102 files / 1899 tests, 0 skipped, ×2 | Met |
| adding an unguarded server action makes the guard test fail | CI `test` job step "guard canary" (`scripts/ci/guard-canary.mjs`: plants `features/__guard_canary__/actions.ts`, requires `guard-actions.spec.ts` to fail and name it); `tests/security/guard-canary.spec.ts` (incl. the per-reference forging proof) | Met |
| the M0 baseline report is committed | `evidence/m0-baseline/README.md` (commit-pinned, tool-generated) | Met |

Scope items: P0-11 (`.github/workflows/ci.yml`, `nightly.yml`, CODEOWNERS, settings evidence; branch ruleset pending PR #3 —
see below) · P0-13 (`tests/security/guard-*.spec.ts`, 110 actions / 46 route methods) · P1-27 (Playwright scaffold, six
characterisation flows + journeys 1/8/9, type-checked tests, deletions listed in `02-SUMMARY.md`) · P1-41 report-only
coverage (CI step summary) · PWA-08a (desktop / Pixel 7 / iPhone 15 in the PR lane; full matrix in `nightly.yml`) ·
AI-06 L1 (`scripts/ci/ai-l1-greps.mjs`, fixture-tested) · R8 from V2-01 (`tests/e2e/a11y/v2-01-screens.spec.ts`: login,
forgot-password, join at 360/820/1280 px with 0 serious/critical axe violations and no horizontal scroll).

## Reviews (CLAUDE.md DoD 6) — reports in `reviews/`
| Range | Reviewer | Verdict | Outcome |
|---|---|---|---|
| `2695964..63cb713` | Independent | approve-with-fixes (one more cross-tenant write; guard leg could pass vacuously; inline actions not inventoried) | fixed in 02-06 |
| same | Adversarial | pass-with-fixes (0 C/H; 3 M: lab visit ref, guard blind spots incl. multi-clinic users, ruleset not yet applied) | fixed in 02-06; ruleset pending PR #3 |
Every fix has a test that fails without it. The 02-06 delta and the auth-form fix were verified by the full Vitest lane,
the guard canary and the Playwright PR lane (repeated runs for the formerly flaky journeys); triage in `02-PLAN.md`.
Two CI-only flakes were root-caused, not retried to green: journey 1 (a GET login form — fixed in product) and journey 9
(response capture blocked on a never-closing RSC prefetch stream; unreadable bodies had silently passed — the test now
bounds reads, fails on unreadable bodies, checks the server HTML directly and isolates each probe in a fresh page).

Required checks on `feature/v2`: ruleset `feature-v2-ci` (id 27150224) applied after PR #3 merged; `main` and `v2rules`
unchanged (`evidence/github-settings/`, empty diffs).

## Not yet verifiable (owner)
- The first scheduled nightly run: needs `nightly.yml` on the default branch (`feature/v2`), i.e. after merge.
- CI run links for the merged state of `feature/v2`: after merge.
