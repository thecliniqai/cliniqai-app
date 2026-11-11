---
phase: 01A
roadmap_id: V2-01a
status: awaiting PO gate approval
verified_commit: 40b4d48730d7b60599275dc67dc5b9760eb5b0b0
---

# Phase 01A (V2-01a) — verification

All counts are in the tool-produced files under `evidence/`, generated from Vitest's JSON reporter and `psql`
by a script on commit `40b4d48`; nothing below is hand-typed from a run. CI links: not available until V2-02.

| Acceptance criterion (roadmap §12.2, verbatim) | Evidence | Result |
|---|---|---|
| all 69 files run locally with 0 failures attributable to the environment | `evidence/full-run-1.json`, `evidence/full-run-2.json` (`per_file`: every file `passed`; the 69 pre-existing spec files are unchanged — `git diff origin/feature/v2 -- 'tests/**/*.spec.ts'` touches only the two new `tests/setup/*.spec.ts`) | Met |
| 0 skipped in the DB lane | `evidence/summary.json` (`tests_skipped` per run) | Met |
| the guard aborts a run pointed at any non-local URL | `evidence/guard-abort-hosted-url.txt` (real `vitest run` with a hosted URL: config load refused); `evidence/guard-spec-output.txt` (rule set incl. end-to-end abort) | Met |
| zero tests reach a hosted URL | Vitest never reads `.env` (`vitest.config.ts`, `envDir: false`); keys must be local-issuer; workers refuse non-loopback sockets/fetch and resolve non-loopback DNS offline; `.env*` loads refused in workers (`guard-spec-output.txt`) | Met |

Teardown (01a-03): `evidence/summary.json` (`teardown` line per run) and `evidence/post-run-db-counts.txt` (local
stack empty after two consecutive runs). Leak check, FK-list drift check and run lock: `tests/setup/teardown.spec.ts`.

AUTH-00 (01a-04): `01A-04-AUTH00-SPIKE.md`; five contradicted AUTH_REDESIGN assumptions logged as A00-1…A00-5 in
`docs/v2/VERIFICATION_LOG.md` for a PO ruling. Hosted-only items re-checked in V2-03.

## Reviews (CLAUDE.md DoD 6)
- Independent reviewer (fresh context): no blockers/majors; 4 minor + 6 nits. Fixed: missing
  `schedule_blocks.created_by` (now pinned to the live catalog), leak-check ordering/message, run lock, placeholder
  pattern, fetch fail-closed. Not fixed in code: CLAUDE.md command text (PO edit, see below); `tsc` still excludes
  `tests/` (E-7, P1, later phase).
- Adversarial reviewer: no path to hosted Supabase. Refuted "no other hosted service" (real DNS lookups) and
  "teardown removes exactly the run's data" (time window, concurrent runs) — both fixed. Also fixed: Vite env read,
  socket-level block, proxy vars, `.env` load block. Deferred: Playwright `webServer` with `.env.test` and browser
  `page.route` block → V2-02 (no e2e specs exist yet); global fixture rows (`test-cdci-*`) and killed-run leftovers
  are accepted residue (`npx supabase db reset --local`).

## Open for the PO
1. **CLAUDE.md "Commands"** still shows the pre-V2-01a override command, which the guard now refuses. Editing
   CLAUDE.md was blocked for the agent (self-modification); proposed text is in the PR description.
2. **AUTH-00 rulings** A00-1…A00-5 before V2-01 (AUTH-01/04a) and V2-03.
3. During the first baseline run (before the fix), `scripts/msg91-sync-templates.ts` loaded `.env` inside one test
   worker; that spec stubs `fetch`, nothing was sent and no value was printed. Fixed in `4838de1`.
