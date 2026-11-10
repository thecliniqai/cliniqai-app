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
- `npm run typecheck` · `npx eslint .`
- Tests: `vitest.config.ts` loads `.env` itself (any variable not already set in the shell), and the
  seed/msg91 scripts use `--env-file=.env`, so a bare `npm test`, `npx vitest` or `npx playwright` can
  reach the hosted project. Until the local DB harness (phase V2-01a) lands, do not run vitest,
  playwright or any script without PO approval; the only approved form overrides every external service:
  `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 NEXT_PUBLIC_SUPABASE_ANON_KEY=x SUPABASE_SERVICE_ROLE_KEY=x SUPABASE_ACCESS_TOKEN=x MSG91_AUTH_KEY=x MSG91_WEBHOOK_SECRET=testsecret MSG91_INTEGRATED_NUMBER=x MESSAGING_PROVIDER=dev AI_PROVIDER=mock AI_API_KEY=x npx vitest run --reporter=dot`
  (expected: DB-backed files fail against the dead endpoint; see `docs/v2/TEST_STRATEGY.md`). Empty
  overrides do not work (the loader fills unset or empty keys), and R2 cannot be disabled this way, so the
  PO confirms `R2_*` is unset in `.env` (`docs/ops/secret-rotation.md`). Delete
  `.planning/dev-messages.txt` if the run recreates it.
- GSD is installed project-local and pinned: `npx -y @opengsd/gsd-core@1.16.0 --claude --local`
  (`.claude/*` other than `settings.json` is git-ignored, so the pin is recorded here).
- Local DB (after V2-01a): `npx supabase start` / `npx supabase db reset`

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
2. typecheck, lint and relevant tests pass locally; CI green on the PR (once CI exists, V2-02).
3. UI checked at 360px, tablet and desktop; axe clean.
4. Diff reviewed for unrelated changes, secrets and PHI.
5. Evidence in the GSD VERIFICATION.md is produced by the tools (CI link + commit SHA), never hand-typed.
6. Independent review by an isolated Claude reviewer agent (fresh context, no implementer reasoning);
   security-sensitive changes (migrations, RLS, permissions, middleware, auth, billing, platform admin,
   PHI) also get an adversarial second review. The PO approves every gate.
