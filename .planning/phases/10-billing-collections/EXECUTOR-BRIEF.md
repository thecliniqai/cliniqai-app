# V2-10 per-plan executor brief (shared by every plan executor)

You build ONE plan of `.planning/phases/10-billing-collections/10-PLAN.md` in `/home/sid/clinicOS` on branch
`v2/phase-10-billing` (already checked out; do not switch branches, do not push). You are the only user of the local
Supabase stack while you run.

Read first, in this order: `/home/sid/clinicOS/CLAUDE.md` (non-negotiables are absolute), `10-PLAN.md` (DECISIONS, the
"Shared rules for every plan (09E conventions)" section, your plan's section, Acceptance, Threat register),
`10-RESEARCH-NOTES.md` (file:line inventory; re-check line numbers), `10-NOTES.md` (what earlier plans did and decided).

Absolute rules (from CLAUDE.md and the PO):
- Never read or print `.env*`. Never hosted Supabase, never `--linked`, never `db push`. Never run `seed:cdci*`,
  `seed:diagnoses`, `msg91:*`, or anything with `--env-file=.env`. Synthetic data only; no PHI in code, logs, fixtures.
- Never edit an applied migration (any existing file in `supabase/migrations/`); add only your plan's migration number
  (range 000140-000149). Every tenant table has `tenant_id` + RLS. No service-role client in request paths. Every server
  action/route authenticates, checks permission, derives the tenant from the session.
- No new npm dependency. No `pkill -f`, no self-matching `pgrep` wait loops. Never commit to or check out `main`. No force-push.
- Delete `.planning/dev-messages.txt` if a run recreates it. If a design/screenshot run overwrites committed 09B
  screenshots, discard those changes (`git checkout -- <paths>`).
- Never set a mode when starting a subagent (you should not need subagents).

09E conventions (mandatory):
- `scripts/perf/latency-ceilings.mjs` ceilings may only be LOWERED, never raised. Lane rows you add in
  `tests/e2e/perf/latency-budgets.ts` must pass; tag CI-subset rows `@budget`. A failing row is root-caused.
- Stale writes take `p_expected_version` (last param, DEFAULT NULL) and refuse with `ROW_CHANGED` (P0001); command
  replay (`private.command_claim`) BEFORE the version compare; lock then compare.
- Writes move `clinic_versions` (the `billing` version) through statement triggers so live screens converge; one
  signal per transaction (pgTAP case).
- Registries in the same commit as the migration: `app/api/ready/expected-migration.ts`, schema snapshot
  (`node scripts/drift/schema-snapshot.mjs --local --write` then `--check`), `npm run db:types`,
  `scripts/ci/assert-pgtap-report.mjs` (REQUIRED_FILES + FLOOR with the arithmetic in a comment),
  `scripts/ci/assert-vitest-report.mjs` REQUIRED_FILES for new Vitest files, `tests/security/guard-manifest.ts`
  for every added/removed action or route, `tests/helpers/command-catalog.ts` for every new command,
  `grants.test.sql` grantee sets, `lib/db/errors.ts` for new P0001 reasons.
- One "fails-without" proof per High control named in your plan: temporarily break the control (inside a rolled-back
  transaction or a local-only edit), run the test, see it go red, restore, and record the red output line in NOTES.
- Tests assert real outcomes (rows, numbers, statuses, audit rows, DOM after reload); no "renders" or source-grep tests.

Commands to run (and record counts from tool output in NOTES):
- `npx supabase db reset --local` after adding the migration; `npm run db:types`.
- Affected pgTAP: `npx supabase test db supabase/tests/database/<file>.test.sql` (and any existing pgTAP file your
  change touches: grep `supabase/tests/database` for the functions/tables you change).
- Affected Vitest: `npx vitest run <paths>` (stack up). Use the plan's "Affected-test discovery" grep, narrowed.
- `npm run typecheck`, `npx eslint .`, `npm run inventory`, `npm run ci:ui-policy`.
- If you touch UI or add e2e: `npm run e2e:build`, then
  `npx playwright test <files> --project=desktop-chrome --project=pixel-7 --project=iphone-15 --retries=0`, and the
  lane rows with `npm run perf:latency -- --grep <row ids>`. A test that only passes on retry is a defect: root-cause it.
- `npm run stack:recycle` only BEFORE you start (not mid-run).

Small decisions: decide yourself, add one line with a rationale to the "Executor decisions" table in `10-NOTES.md`
(next free E-number). Small bugs found elsewhere: forward-fix and list under "Forward-fix items". Only stop (and report
without committing the offending part) if something would violate CLAUDE.md or contradict an approved doc in
`docs/v2` in a large way.

Finish:
1. Append a section `## 10-0N <name>` to `10-NOTES.md`: changes, deviations, grep hits, commands run with counts
   copied from tool output, lane rows with their JSON values, fails-without records, security-sensitive files.
2. Commit (one or a few commits) with identity flags and this trailer, e.g.
   `git -c user.name=Claude -c user.email=noreply@anthropic.com commit -m "feat(10-0N): ...` + blank line +
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` + newline +
   `Claude-Session: https://claude.ai/code/session_01T9X7vCyQ9Lrcgq3ixT9dS3`.
   Check `git status` is clean apart from intended files; never commit `.env*`, `test-results/`, playwright reports.
3. Report back: commit SHAs, migration added, test counts (pass/fail), lane row values, decisions, forward-fix items,
   anything left undone and why, and any PO action (hosted/staging steps go in `.planning/PO-ACTIONS.md`).
