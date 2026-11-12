# Sub Agent Rule
Never set a mode when starting a subagent.

# clinicOS — working agreement for coding agents

Clinic management SaaS for independent doctors and small clinics in India (roles: owner/admin, doctor,
receptionist, nurse; plus platform admins). Handles patient health data: treat every record as sensitive.
Team = the product owner (PO) + Claude. Claude Code is the only coding tool.

## Sources of truth (read before planning; do not contradict)
- Scope, priorities, phases, gates: `docs/v2/V2_MASTER_ROADMAP.md` (§1.2 decisions, §10 backlog, §12 phases)
- Verified findings and rulings: `docs/v2/VERIFICATION_LOG.md`
- Architecture: `docs/v2/TARGET_ARCHITECTURE.md`, `docs/v2/ARCHITECTURE_DECISIONS.md`, `docs/adr/`
- Design system: `docs/v2/DESIGN_SYSTEM.md`; new scope: `docs/v2/SUBSCRIPTIONS_AND_PLANS.md`,
  `AI_STRATEGY.md`, `AUTH_REDESIGN.md`, `PWA_STRATEGY.md`
- Execution state: `.planning/` (GSD). Requirements live in the approved docs, not in plans.
If a task conflicts with an approved decision, STOP and raise it with the PO. Never silently change
architecture, requirements, schema or design.

## Stack
Next.js 15 App Router · React 19 · TypeScript (strict) · Tailwind v4 · Supabase (Postgres, Auth, RLS,
Storage) via @supabase/ssr · zod · Vitest · Playwright. Code: `app/` (routes), `features/<domain>/`,
`lib/` (cross-cutting), `components/`, `supabase/migrations/`, `tests/`.

## Commands
- `npm run typecheck` (app + tests) · `npx eslint .` · `npm run inventory` (server-action inventory, exits 1 on a flag)
- Local stack: `npx supabase start -x studio,edge-runtime,logflare,vector,imgproxy,supavisor` ·
  `npx supabase db reset --local` (re-applies all migrations). Never `--linked`, never `db push`.
- Unit + DB tests: `npm run test:db` (starts the stack, then `vitest run`) or `npx vitest run` with the stack
  up. They run freely: `vitest.config.ts` never reads `.env`, uses the local stack keys, and a fail-closed
  guard refuses any non-loopback Supabase URL or outbound network. Coverage: `npm run test:coverage`.
  Delete `.planning/dev-messages.txt` if a run recreates it.
- Browser tests: `npm run e2e:build`, then `npm run e2e:pr` (desktop, Pixel 7, iPhone 15). The e2e server
  is locked down (allowlisted env, no `.env` loading, loopback only, port 3100). `npm run e2e:nightly` is the
  full device matrix; `npm run e2e:baseline` regenerates the M0 report.
- Synthetic local logins: `npm run seed:local` (loopback only; `-- --reset` removes them).
- NEVER run: `seed:cdci*`, `seed:diagnoses`, `msg91:*`, or anything with `--env-file=.env` — they target
  the hosted project or send real WhatsApp messages.
- Gate evidence: `node scripts/phase-evidence.mjs <phase>/evidence 2` (two full runs + static checks) and
  `node scripts/phase-evidence.mjs <phase>/evidence --ci-run <id>`. Never hand-type results.
- CI: `.github/workflows/ci.yml` runs static, security, test, build and e2e on every PR; all five are
  required to merge into `feature/v2`. A test that only passes on retry is a defect: root-cause it.
- GSD is installed project-local and pinned: `npx -y @opengsd/gsd-core@1.16.0 --claude --local`
  (`.claude/*` other than `settings.json` is git-ignored, so the pin is recorded here).

## Non-negotiables
- Work on `v2/phase-<n>-<slug>` branches off `feature/v2`; PR into `feature/v2`. Never commit to or
  check out `main` (v1 baseline, tag `v1.0-mvp-baseline`). No force-push.
- Every tenant table has `tenant_id` + RLS. No service-role client in request paths unless the approved
  plan says so. Every server action / route authenticates, checks permission, and derives the tenant
  from the session — never from caller input.
- No PHI or secrets in logs, fixtures, prompts to external AI, commits or docs. Synthetic data only.
- Never read or print `.env*` files. Never run tests, seeds or scripts against hosted Supabase.
- Schema changes only via new files in `supabase/migrations/` (expand → migrate → contract); never
  edit an applied migration; no destructive SQL against any shared database.
- Background jobs are idempotent and claim work atomically.
- No new dependency without stating why in the plan.

## Definition of done (per task)
1. Acceptance criteria met; tests assert real outcomes (no "renders" or source-grep tests).
2. typecheck, lint and relevant tests pass locally; CI green on the PR with 0 retried tests.
3. UI checked at 360px, tablet and desktop; axe clean.
4. Diff reviewed for unrelated changes, secrets and PHI.
5. Evidence in the GSD VERIFICATION.md is produced by the tools (CI link + commit SHA), never hand-typed.
6. Independent review by an isolated Claude reviewer agent (fresh context, no implementer reasoning);
   security-sensitive changes (migrations, RLS, permissions, middleware, auth, billing, platform admin,
   PHI) also get an adversarial second review. The PO approves every gate.
