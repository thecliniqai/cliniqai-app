# clinicOS v2.0 — GSD & Development Workflow Assessment (prompt §3, §11, §13)

> **Status:** Discovery and assessment only. No GSD command was run. No configuration, `.planning` file or `CLAUDE.md` was created or changed. The draft `CLAUDE.md` below is a **proposal** for approval.
> **Date:** 2026-11-10 · **Branch:** `feature/v2`
> Labels: **Fact**, **Problem**, **Risk**, **Assumption (validate)**, **Recommendation**. Priorities P0–P3. Sizing is relative (S/M/L).

---

## 1. Executive summary

- **Fact:** GSD (`@opengsd/gsd-core`) **v1.16.0** is installed **project-locally, twice**: for Antigravity in `.agents/` and for OpenCode in `.opencode/`. Both directories are git-ignored. The user-level GSD default runtime is OpenCode (`~/.gsd/defaults.json`: `"runtime": "opencode"`).
- **Fact (corrects the coordinator brief):** At inspection time **no `gsd-*` skills exist under `~/.claude/skills/`**. That directory contains only `android-cli`, `browser-automation`, `game-development`, `synced/` and `.trash/`, and none of these is GSD. The repo has no `.claude/` directory and no `CLAUDE.md`. **GSD is not currently installed for Claude Code.** The GSD workflows themselves name the fix: `npx -y @opengsd/gsd-core@latest --claude --local` (`.agents/gsd-core/workflows/review.md:19`).
- **Fact:** `.planning/` (2.7 MB, 182 tracked files) records a completed v1 milestone: 13 phases and 49 plans, status `completed`, next step `/gsd-new-milestone` (`.planning/state.json`, `.planning/STATE.md:1-15`). The v1 milestone was **never formally closed or archived**: there is no `MILESTONES.md`, and `REQUIREMENTS.md` has not been archived.
- **Problem (P1):** The planning state contradicts itself and has gone stale:
  - `.planning/REQUIREMENTS.md` still lists **10 of 18 requirements as "Pending"** (traceability table, lines ~86–103) while STATE says 100% complete.
  - `.planning/PROJECT.md` still says "Documentation-only brownfield — no application source tree yet". It names the deleted `AGENTS.md` and `DESIGN.md` as engineering and UI authorities, and is dated 2026-10-06.
  - `.planning/codebase/*` describes a repo with no code.
- **Problem (P1):** Phase verification evidence is hand-written and partly wrong. `06-VERIFICATION.md:261` reports "37/37 tests passed" for `tests/api/v1-crud.spec.ts`, which contains 17 tests. Line 264 reports "14/14" for a 15-test file. The only independent reviewer was a free, small model (`opencode/deepseek-v4.1-flash-free`, `06-REVIEWS.md:7,284`).
- **Problem (P1):** `.planning/config.json` is unsuitable for v2. Its only reviewer is an OpenCode lane, and `git.allow_default_branch_commits: true` lets GSD commit directly to the default branch, which is the v1 baseline the prompt (§3 Git safety) says must never be modified.

**Recommendation:** Keep GSD as the execution framework, because its milestone → phase → plan → verify structure matches prompt §11. But:

1. Install it properly for Claude Code at the same pinned version line.
2. Archive v1 with `/gsd-complete-milestone`.
3. Replace `config.json`.
4. Make the approved `docs/v2/*` documents the single source of truth.
5. Use a different model family as the independent reviewer.
6. Require CI-produced evidence for verification.

---

## 2. Inventory: what is installed and where

| Location | Content | Tool | Tracked in git? | Verdict |
|---|---|---|---|---|
| `.agents/` | `gsd-core/` (VERSION `1.16.0`), 72 `skills/gsd-*`, `agents/`, `hooks/` (28 incl. `gsd-secret-read-guard.js`, `gsd-prompt-guard.js`, `gsd-validate-commit.sh`), `settings.json` (SessionStart/AfterTool hooks with a hard-coded `/Users/sid/.nvm/.../node` path), `mcp_config.json` | Antigravity | No (`.gitignore:23`) | Tool-specific. **Not needed for Claude Code.** |
| `.opencode/` | `gsd-core/` (VERSION `1.16.0`), `commands/`, `plugins/`, `hooks/`, `node_modules/`, `opencode.json` (GSD MCP server via `npx @opengsd/gsd-core gsd-mcp-server`) | OpenCode | No (`.gitignore:24`) | Tool-specific. **Not needed for Claude Code.** |
| `.gsd/` | `dispatch-isolation-sentinel.json` (phase `05.3`), self-ignoring `.gitignore` (`*`) | GSD runtime state | No | Stale runtime artefact. Safe to delete after approval. |
| `~/.gsd/defaults.json` | `{"resolve_model_ids":"omit","runtime":"opencode"}` | GSD (user) | n/a | Default runtime is OpenCode. Change to Claude once installed. |
| `~/.claude/skills/` | No GSD skills | Claude Code | n/a | **GSD absent for Claude Code.** |
| `.planning/` | PROJECT, REQUIREMENTS, ROADMAP, STATE, `state.json`, `config.json`, `phases/` (13 dirs, 161 files), `codebase/` (7 map docs, 2026-10-06), `intel/`, `research/`, `onboarding/`, `INGEST-CONFLICTS.md`, plus git-ignored `dev-auth-logs.txt` and `dev-messages.txt` | GSD artefacts | Yes (except dev logs and `.cache`) | **Keep as history.** Archive as v1 (see §5). |
| `AGENTS.md`, `DESIGN.md` | Deleted in `a6373b4` (1,698 + 2,258 lines) | Antigravity / OpenCode convention | Historical only | Do not restore. Mine for requirements (§3). |

**Risk (P1):** The previous setup relied on GSD hooks for safety (secret-read guard, prompt-injection scanner, commit validation). None of these protections exist in Claude Code until it is configured. Without a `permissions.deny` for `.env*`, an agent can read the service-role key. Add Claude Code deny rules for `.env`, `.env.*` (except `.env.example`), `**/*.pem` and `supabase/.temp/**` before any v2 implementation session.

**Risk (P2):** The `.agents/` and `.opencode/` directories pollute ESLint (2,544 errors attributed to them, coordinator) and agent search context. Once GSD is installed for Claude Code, move them out of the working tree. Do not delete them blindly; archive them outside the repo with owner approval.

---

## 3. Separating tool-specific configuration from real requirements

### 3.1 Tool-specific (drop for v2)

- GSD runtime installs (`.agents/`, `.opencode/`), their hooks, MCP config, statusline and update checks. Also the Cursor and Windsurf hook variants under `.agents/hooks/`.
- `.planning/config.json` review lanes (`opencode`), `_auto_chain_active` runtime flag, `.gsd/` sentinel.
- `AGENTS.md` §2 "Instruction Priority", §3 "DESIGN.md is canonical design authority", §47 workflow ceremony, and all references to `DESIGN.md` and TailAdmin as authorities. The prompt's legacy policy (§3) explicitly removes their authority.
- `.planning/phases/**/0x-UI-SPEC.md` and `02.1` TailAdmin decisions. These are v1 design decisions superseded by the v2 design workstream.

### 3.2 Genuine product and engineering requirements to carry forward (re-approve in v2 docs)

| Requirement | Source | Carry into |
|---|---|---|
| Target customer, roles (Owner/Admin, Doctor, Receptionist, Nurse), ₹1,000 flat single plan, no feature gating, "under 3 taps", phone-first | `.planning/PROJECT.md:3-20`; PRD | PRODUCT doc / roadmap |
| 18 requirement IDs with acceptance criteria (multi-tenancy, booking, records, templates, diagnosis, e-Rx, labs, reminders, referrals, billing (provisional), AI, API, ABDM-ready data layer, NFRs) | `.planning/REQUIREMENTS.md` | v2 REQUIREMENTS (re-validated, not copied blindly) |
| Out of scope: voice agent, IPD, insurance/NHCX, live ABDM, native apps, multi-language, teleconsultation, payment gateway | `.planning/PROJECT.md` "Out of Scope" | v2 scope statement (confirm with owner) |
| Tenant isolation at DB level (RLS), not only in the app | `AGENTS.md` §7; REQ-nfr-multi-tenancy-scalability | Architecture + pgTAP gate |
| RBAC at API and UI; audit every patient-record access; OTP staff auth; no shared logins | `AGENTS.md` §8–10; PRD §5.3 | Security doc |
| Sensitive-data handling: no PHI in logs, AI output labelled until clinician accepts, AI never record of truth | `AGENTS.md` §9, §40; PROJECT principles | Security + AI policy |
| Idempotent jobs, transactional outbox, no duplicate notifications on worker restart; concurrency via constraints, not UI | `AGENTS.md` §42–43 | Backend architecture (currently violated: `lib/messaging/dispatcher.ts:129-150`) |
| Migration safety: explicit files, staged/destructive-change plans, tested upgrade paths | `AGENTS.md` §38 | Migration workflow (INFRASTRUCTURE §4.4) |
| Testing pyramid and named E2E journeys (login, patient create and search, booking, status transition, consultation, prescription, invoice, role restriction, tenant isolation) | `AGENTS.md` §27 | TEST_STRATEGY §7 (already aligned) |
| Verification before completion (typecheck, lint, tests, diff review, no secrets) | `AGENTS.md` §28 | CLAUDE.md "Definition of done" |
| Production-readiness checklist (backups and tested restore, alerting, CI/CD, rollback, a11y, responsive) | `AGENTS.md` §46 | V2 roadmap release gate |
| Pluggable messaging and storage providers; avoid deep Supabase coupling | PRD §6; PROJECT constraints | Architecture (re-evaluate; do not assume) |
| 99.5% uptime, core actions 1–2 s on 3G/4G, provider outage must not block clinical work | PRD §5.2, §5.5 | NFRs / SLOs |
| Open question: billing scope provisional; data residency unconfirmed | `.planning/INGEST-CONFLICTS.md`; PRD §9 | Product-owner decisions log |

---

## 4. Problems with the v1 GSD configuration and state

| # | Finding | Evidence | Priority |
|---|---|---|---|
| G-1 | `allow_default_branch_commits: true` lets GSD commit on the default branch (`main`, the v1 baseline) | `.planning/config.json`; read by `.agents/gsd-core/bin/lib/git-base-branch.cjs:167` | **P0** (process safety) |
| G-2 | The only reviewer is `opencode/deepseek-v4.1-flash-free`, which is unavailable in Claude Code and too weak for security-sensitive review | `.planning/config.json`; `06-REVIEWS.md:7` | P1 |
| G-3 | `branching_strategy` is unset (default `none`), so all phases committed straight to the working branch | `config-defaults.manifest.json` `git.branching_strategy: "none"` | P1 |
| G-4 | Verification evidence is hand-typed and inaccurate, with no CI links | `06-VERIFICATION.md:259-269,321` vs the actual test counts | P1 |
| G-5 | REQUIREMENTS, STATE and PROJECT disagree; PROJECT and the codebase map are stale and point to deleted authorities | §1 | P1 |
| G-6 | v1 never archived (`/gsd-complete-milestone` not run) | No `MILESTONES.md` | P1 |
| G-7 | Many inserted decimal phases (02.1, 03.1–03.3, 05.1–05.3) show scope growth mid-milestone without re-approval | `.planning/ROADMAP.md:57-284` | P2 (lesson) |
| G-8 | Dev OTP and message logs written into `.planning/` (ignored, but read by agents) | `lib/auth/dev-logger.ts:44`; `lib/messaging/dev-logger.ts:89` | P2 |
| G-9 | GSD's default `claude_md_path` is `./.claude/CLAUDE.md`. If left unset, GSD may generate a second instruction file alongside a root `CLAUDE.md` | `config-defaults.manifest.json` | P2 |

---

## 5. Recommendations

### 5.1 Archive vs keep

| Item | Action | Priority |
|---|---|---|
| `.planning/phases/**`, ROADMAP, REQUIREMENTS, STATE, PROJECT | **Archive as milestone v1.0** with `/gsd-complete-milestone` (it writes `MILESTONES.md`, archives the ROADMAP and REQUIREMENTS, and starts fresh). Before running it, fix the REQUIREMENTS traceability statuses so the archive is truthful (mark them "implemented in v1, not production-verified"). **Note:** the workflow creates a git tag. Run it on `feature/v2` and name the tag `v1.0-mvp-baseline` so nothing touches `main`. | P1 |
| `.planning/codebase/*` (stale map) | Regenerate after archive with `/gsd-map-codebase` for v2 (it is read by planners) | P1 |
| `.planning/intel/`, `research/`, `onboarding/`, `INGEST-CONFLICTS.md` | Keep as history (moved under the v1 archive) | P3 |
| `.planning/config.json` | Replace (see §5.3) | **P0** |
| `.planning/dev-*.txt` | Move dev loggers to `tmp/` (code change, later phase) and delete the files | P2 |
| `.agents/`, `.opencode/`, `.gsd/` | After GSD works in Claude Code, move them out of the repo (owner approval) | P2 |
| `docs/v2/*` assessment docs + `V2_MASTER_ROADMAP.md` | **Keep: the v2 source of truth** once approved | P0 |

### 5.2 Installing and starting the v2 milestone with GSD in Claude Code

1. **Install GSD for Claude Code, project-local and pinned:** `npx -y @opengsd/gsd-core@1.16.0 --claude --local`, or the latest version after reading its changelog. Run `--help` first to confirm the flags. Verify that `/gsd-help` lists the commands and that `gsd-tools runtime-identity` reports `@opengsd/gsd-core`. Commit only the parts GSD intends to be shared (decide whether `.claude/` skills are committed or git-ignored; recommendation: commit `.claude/settings.json` and `CLAUDE.md`, and ignore installer-managed GSD files the way `.agents/` was).
2. Set `~/.gsd/defaults.json` `runtime` to `claude`, or rely on the local install.
3. Add Claude Code `permissions.deny` rules for secrets (§2) and an allowlist for the safe commands (`npm run typecheck`, `npx vitest run` with the local-stack env, `npx eslint`).
4. Correct the v1 traceability and run `/gsd-complete-milestone` (v1.0) on `feature/v2`.
5. Replace `.planning/config.json` (§5.3).
6. Run `/gsd-new-milestone` for **v2.0**, feeding it the approved `docs/v2/V2_MASTER_ROADMAP.md` and the assessment docs (`/gsd-ingest-docs` can import them). Milestone scope comes **only** from the approved roadmap.
7. Run `/gsd-map-codebase` to refresh the code map.
8. Per phase: `/gsd-discuss-phase` → `/gsd-plan-phase` (plan-check on) → **human approval gate** → `/gsd-execute-phase` → `/gsd-code-review` + `/gsd-review --codex` (independent model) → `/gsd-secure-phase` (for auth, RLS and data phases) → `/gsd-verify-work` with CI links → merge PR.

**Phase-shaping rule:** Phase 0 should be "Engineering foundations" (CI, local Supabase test harness, environments, env schema, secrets hygiene, ESLint scope). It comes before any feature or redesign work, so every later phase can produce automated evidence.

### 5.3 Proposed `.planning/config.json` for v2 (for approval; keys verified against `gsd-core/bin/shared/config-*.manifest.json`)

```json
{
  "mode": "interactive",
  "claude_md_path": "./CLAUDE.md",
  "git": {
    "branching_strategy": "phase",
    "base_branch": "feature/v2",
    "protected_branches": ["main"],
    "allow_default_branch_commits": false,
    "phase_branch_template": "v2/phase-{phase}-{slug}"
  },
  "gates": { "execute_next_plan": true, "confirm_transition": true, "confirm_milestone_scope": true },
  "workflow": {
    "research": true,
    "plan_check": true,
    "verifier": true,
    "code_review": true,
    "code_review_depth": "standard",
    "security_enforcement": true,
    "security_asvs_level": 2,
    "security_block_on": "high",
    "ui_phase": true,
    "ui_safety_gate": true,
    "auto_advance": false
  },
  "review": {
    "default_reviewers": ["codex"]
  }
}
```

**Assumption (validate):**
- Codex CLI (`~/.codex` exists) or Gemini is available for the independent reviewer lane. If neither is, use a separate Claude Code reviewer subagent with no access to the implementer's context, and require human review on P0 areas.
- `security_asvs_level: 2` is the right level for health data. Confirm this with the security workstream.

### 5.4 Task template (every GSD plan and task)

```markdown
## Task <phase>.<plan>.<n> — <title>
- **Objective:** one sentence, user/business outcome.
- **Requirement / decision refs:** REQ-…, ADR-…, docs/v2/<doc>#<section> (must exist and be approved).
- **Scope:** in / explicitly out.
- **Dependencies:** tasks, migrations, env, external accounts.
- **Expected changes:** files/modules, migrations (name), config, docs — anything else requires re-approval.
- **Acceptance criteria:** observable, testable statements (Given/When/Then).
- **Tests:** new/changed tests by layer (unit · DB/pgTAP · MSW contract · E2E+axe); "renders" or source-grep tests are not acceptable.
- **Security / privacy check:** tenant isolation, role, PHI in logs, secrets — yes/no with reason.
- **Verification evidence:** CI run URL + commit SHA; screenshots for UI at 360px and 1280px; migration applied to staging log.
- **Rollback:** how to revert (code revert, forward-fix migration, feature flag).
- **Size:** S / M / L (no day estimates).
```

### 5.5 Independent review approach (prompt §13)

> Update (2026-11-10, PO decisions): PO-10 and PO-11 replace this section's reviewer model. The tooling is **Claude Code only**: install GSD for Claude Code (project-local, pinned) in V2-00, and retire `.agents/` (Antigravity) and `.opencode/` together with the OpenCode/DeepSeek reviewer in `.planning/config.json`. There is **no human reviewer and no second model family**. The independent lane is an **isolated Claude reviewer agent**: a fresh context, read-only tools, the diff, the plan and the governing docs, and none of the implementer's reasoning. Security-sensitive changes (migrations, RLS, permissions, middleware, auth, billing, platform admin, PHI) get a second, adversarial reviewer prompt in place of the human sign-off below, and CODEOWNERS names the PO. The PO approves every gate. The residual risk of shared blind spots is roadmap R13. The `default_reviewers` value in §5.3 becomes a Claude reviewer sub-agent, not `codex`.

- **The implementer never approves its own work.** The GSD `code_review` plus an **independent lane from a different model family** (`/gsd-review --codex` or `--gemini`), given the diff, the plan and the governing docs, *not* the implementer's reasoning.
- **Security-sensitive changes require a human sign-off in addition.** This covers `supabase/migrations/**`, RLS, `lib/permissions/**`, `middleware.ts`, auth, `lib/supabase/admin*` and anything touching PHI. Enforce it with CODEOWNERS.
- **Evidence is produced by CI, not typed by agents.** `VERIFICATION.md` must link the CI run. A reviewer rejects any count that is not in the CI logs.
- **Every phase gate has a named approver.** Architecture/design approval (before implementation), phase completion, release readiness.

### 5.6 Single source of truth

| Concern | Authoritative file (after approval) | Change rule |
|---|---|---|
| Product requirements and scope | `docs/v2/V2_MASTER_ROADMAP.md` + v2 `.planning/REQUIREMENTS.md` (generated from it) | Change only through a decision entry approved by the product owner |
| Architecture | `docs/v2/` architecture doc + `docs/adr/NNNN-*.md` (new, short ADRs) | Agents may *propose* an ADR; they may not change architecture inside a task |
| Design system | v2 design-system doc (from Workstream B) | Same as above |
| Decisions log | `docs/adr/` (one file per decision; status Proposed/Accepted/Superseded) | Linked from tasks |
| Execution state | `.planning/` (GSD) | Tooling-managed; never the place where requirements are invented |

The `CLAUDE.md` below states that **an implementation agent that finds a conflict with an approved decision must stop and raise it, not silently diverge** (prompt §11).

---

## 6. Proposed minimal `CLAUDE.md` for v2 (draft — not created)

```markdown
# clinicOS — working agreement for coding agents

Clinic management SaaS for independent doctors and small clinics in India (roles: owner/admin, doctor,
receptionist, nurse). Handles patient health data: treat every record as sensitive.

## Sources of truth (read before planning; do not contradict)
- Scope & priorities: docs/v2/V2_MASTER_ROADMAP.md
- Architecture & decisions: docs/v2/*.md, docs/adr/
- Design system: <v2 design-system doc>
- Execution state: .planning/ (GSD). Requirements live in the approved docs, not in plans.
If a task conflicts with an approved decision, STOP and raise it. Never silently change architecture,
requirements, schema or design.

## Stack
Next.js 15 App Router · React 19 · TypeScript (strict) · Tailwind v4 · Supabase (Postgres, Auth, RLS,
Storage) via @supabase/ssr · zod · Vitest · Playwright. Code: app/ (routes), features/<domain>/
(actions, schema, queries), lib/ (cross-cutting), components/, supabase/migrations/, tests/.

## Commands
- npm run typecheck · npx eslint . · npx vitest run (local Supabase only) · npm run test:e2e
- Local DB: npx supabase start / npx supabase db reset

## Non-negotiables
- Work on feature branches off feature/v2; never commit to main. No force-push.
- Every tenant table has tenant_id + RLS; never bypass RLS with the service-role client in
  request paths unless the plan explicitly approves it.
- Every server action / route checks authentication and permission (lib/permissions).
- No PHI or secrets in logs, test fixtures, prompts to external AI, commits or docs. Synthetic data only.
- Never read or print .env files. Never run tests, seeds or scripts against hosted Supabase.
- Schema changes only via new files in supabase/migrations/ (expand → migrate → contract);
  no destructive SQL against any shared database.
- Background jobs must be idempotent and claim work atomically.
- No new dependency without stating why in the plan.

## Definition of done (per task)
1. Acceptance criteria met; tests added at the right layer that assert real outcomes
   (no "renders" or source-grep tests).
2. typecheck, lint and the relevant tests pass locally; CI green on the PR.
3. UI checked at 360px and desktop; axe clean.
4. Diff reviewed for unrelated changes, secrets and PHI.
5. Verification evidence = CI run link + commit SHA in the GSD VERIFICATION.md.
6. Independent review completed (different model/agent); security-sensitive areas also need human sign-off.
```

Keep it short (under ~60 lines). Put detail in the linked docs so the file does not grow into another 1,700-line constitution like the v1 `AGENTS.md`.

---

## 7. Backlog

| ID | Item | Priority | Size |
|---|---|---|---|
| W-01 | Replace `.planning/config.json` (no default-branch commits, protected `main`, phase branches, independent reviewer) | **P0** | S |
| W-02 | Claude Code `permissions.deny` for secrets + safe-command allowlist (`.claude/settings.json`) | **P0** | S |
| W-03 | Install GSD for Claude Code (pinned), verify, set the default runtime | P1 | S |
| W-04 | Fix v1 traceability; `/gsd-complete-milestone` v1.0 (tag `v1.0-mvp-baseline` on `feature/v2`) | P1 | S |
| W-05 | Create `CLAUDE.md` from §6 after the roadmap is approved | P1 | S |
| W-06 | Create the `docs/adr/` convention; record the first ADRs from the approved assessment | P1 | S |
| W-07 | `/gsd-new-milestone` v2.0 from the approved roadmap; Phase 0 = engineering foundations | P1 | M |
| W-08 | Refresh the codebase map (`/gsd-map-codebase`) | P2 | S |
| W-09 | Move `.agents/`, `.opencode/`, `.gsd/` out of the repo; move dev logs out of `.planning/` | P2 | S |
| W-10 | PR template mirroring the task template + CODEOWNERS for sensitive paths | P2 | S |

## 8. Outstanding investigations (questions for the product owner)

1. Will v2 be built **only** in Claude Code, or will Antigravity/OpenCode still be used? (This decides whether `.agents/` and `.opencode/` may be removed.)
2. Which second model or CLI is available for independent review (Codex, Gemini, CodeRabbit)? Is there budget for it?
3. Who is the human approver for the phase gates and the security-sensitive paths?
4. Should the GSD-generated Claude Code files (`.claude/skills/gsd-*`) be committed for collaborators, or installed per developer?
5. Is it acceptable for `/gsd-complete-milestone` to create the `v1.0-mvp-baseline` tag on `feature/v2`?
