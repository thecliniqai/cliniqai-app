# V2-02 adversarial security review — `git diff 2695964..HEAD` (branch `v2/phase-02-ci-e2e-foundations`, HEAD 63cb713)

Reviewer: isolated adversarial reviewer (read-only; no tests or servers run; local DB catalog, GitHub API, and source reads only).

## Verdict: PASS-WITH-FIXES

No Critical or High findings. The CI supply chain, the env lockdown and the evidence hygiene hold up. Two Medium findings
are about the P0-13 cross-tenant reference work: one write path is still open, and the guard engine has a structural
blind spot that let it slip through, plus a second class it cannot model at all. One Medium process gap: the required
checks are not enforced yet.

---

## Findings

### M-1 (Medium): `uploadLabDocument` still stores a caller-supplied cross-tenant `visit_id` (P0-13 fix incomplete)
- `features/labs/service.ts:56-57,76-92,113-129`: `patient_id` is checked against `session.tenantId` (line 82). `visit_id` from
  FormData goes straight into the `patient_documents` insert with no `visitInTenant` check, and no check that the visit belongs
  to that patient.
- DB: `patient_documents.visit_id` FK → `visits(id)` only (single-column FK, confirmed in `pg_constraint`). The RLS policy
  `patient_documents_tenant_isolation` checks only the row's own `tenant_id`.
- Steps: a tenant-A user with `patients:edit` (receptionist or nurse) posts FormData with an A `patient_id`, B's `visit_id` and a
  valid PDF. The result is an A document row that points at B's visit, which is the exact defect class OA-4 says is closed.
  It also works as an existence oracle for B visit ids: a nonexistent id hits an FK error ("Failed to save document metadata"),
  an existing B id succeeds. UUIDs keep the oracle weak.
- Why the guard missed it: see M-2(a). `tests/security/cross-tenant-refs.spec.ts` does not list `uploadLabDocument`.
- Fix: `if (visit_id && !(await visitInTenant(ctx, visit_id, patient_id))) return …` before the storage upload. Add a
  regression case to `cross-tenant-refs.spec.ts` and add `patient_documents` to the OA-4 V2-05 composite-FK list.
- Related, outside the range (`/api/v1`, switch off by default): `app/api/v1/referrals/route.ts:184-194` and
  `app/api/v1/lab-orders/route.ts` check `visit_id` for the tenant but not that it is the same patient. This is a same-tenant
  mismatch only.

### M-2 (Medium): P0-13 guard engine blind spots (an under-guarded action can pass)
a. **All-B-ids-at-once forging.** `tests/security/guard/engine.ts:251-286` (`forgedObject`/`argsFor`) puts tenant B's ids
   into every id field at the same time. Any action that checks its *first* reference (normally `patient_id`) and refuses
   never reaches the unchecked second reference. Leg 3 therefore cannot detect "patient checked, visit/doctor not checked".
   M-1 is a live instance. On top of that, the FormData forgery never includes a `file`, so `uploadLabDocument` returns at
   "file required" and none of its body runs. Fix: in leg 3, also run one variant per id field (A's valid ids everywhere
   except one B id). For FormData actions, attach a minimal valid file.
b. **No multi-membership user in the guard world.** `tests/security/guard/world.ts` seeds A roles, B owner, `noMember`
   and `outsider`, but no user who is a member of two clinics. RLS on `visits`/`queue_tokens` is `tenant_id IN
   current_user_tenant_ids()` (every membership, verified in `pg_policies`). Several services read and update by id with
   RLS as the only scope, with no `.eq("tenant_id", ctx.tenantId)`: `features/queue/service.ts:32-42` (checkInVisit read)
   and `:112-122` (visit status update), and `features/visits/service.ts:192,211,261,280,332,354`. A user who is a member of
   A and C sets the `clinic_active_tenant` cookie to A themselves (`lib/auth/tenant.ts:66-82` accepts any of their
   memberships). With A's role they can then check in or change C's visits, and they get an A `queue_tokens` row that
   references C's visit. The legs never exercise this because nobody holds two memberships. The code is pre-existing
   (F9/P1-12, V2-08), but the guard as designed cannot see it. Fix: add a dual-member user (A role X, B role Y) to the guard
   world, run leg 3 with it, and assert B is unchanged and no A row references a B id. Add tenant filters, or
   `visitInTenant`, to the listed services, or record a ruling that defers this to V2-08.
c. Inventory scope (low, no current instances): only module-level `"use server"` in `.ts/.tsx` under
   app/features/lib/components (`scripts/inventory-server-actions.ts:136-142, 359-362`). Inline `"use server"` functions
   and `route.js/.tsx/.jsx` (valid with the default `pageExtensions`) are not inventoried, so they would bypass the
   completeness check. A one-line ESLint ban on inline `"use server"` plus a widened route regex closes it.
d. The `api-v1` route kind only tests "switch off → 404" and "switch on, no key → 401"
   (`engine.ts:621-638`). No leg calls a v1 route with a valid A key and B ids, although these routes use the service-role
   client, so the tenant filters in the handler are the only scoping. Acceptable while `API_V1_ENABLED` is off; it needs a
   leg before PO-16 turns the switch on.

### M-3 (Medium, process): CI checks are advisory until the `feature-v2-ci` ruleset is applied
- Live state, read via `gh api` today: only ruleset `v2rules` exists; `rules/branches/feature/v2` has no
  `required_status_checks`; `required_approving_review_count: 0`. `02-01-github-settings.md` "Applied" records step (b) as
  deferred until PR #3 merges.
- Impact: a red `security`/`test` job (gitleaks hit, audit gate, P0-13 guard) does not block a merge into `feature/v2`.
  Every gate in this phase is advisory until (b) lands. Track it as a blocking gate item; do not merge #4 before (b) is
  applied.

### Low
- **L-1 Nightly issue squatting**: `.github/workflows/nightly.yml:143-148` finds the issue by title only. Any GitHub user
  can open "Nightly failing" first, and the bot (issues: write) then posts run links and comments there. The attacker
  controls that issue's body and can close it. Fix: add `--author app/github-actions` to `gh issue list`.
- **L-2 Fork PR workflow approval** is `first_time_contributors` (`actions/permissions/fork-pr-contributor-approval`).
  Every job runs PR code (npm lifecycle scripts, Docker, Playwright) on a public repo. With no secrets and a read-only token
  the impact is limited to runner abuse, and caches stay PR-scoped (verified with the caches API). Consider
  `all_external_contributors`.
- **L-3 Audit waiver severity is self-declared**: `scripts/ci/audit-gate.mjs:94,100` match on GHSA id + package only. If a
  waived advisory is re-rated from high to critical, the "high" waiver still silences it. Fix: require
  `entry.severity === advisory.severity` (or at least that it is not lower).
- **L-4 `.gitleaksignore`/`.gitleaks.toml` are PR-controlled**: the `security` job reads them from the PR merge ref, so a PR
  can add an exact fingerprint for its own leak. CODEOWNERS lists them, but code-owner review is not required (RL-5). Push
  protection (now enabled) is the real control. Reviewers should treat any `.gitleaksignore` diff as security-sensitive.
- **L-5 Network guards do not cover non-`lookup` DNS or UDP**: `server-net-guard.cjs` and `worker-guard.ts` patch
  `dns.lookup`/`dns.promises.lookup` and `net.Socket.connect`. `dns.resolve*`/`dns.Resolver` (c-ares, UDP to the system
  resolver) and `dgram` are untouched, so a hostname can still leave the machine as a DNS query. This leaks hostnames only,
  not data paths to Supabase. Patch `dns.resolve*`/`Resolver.prototype` to reject non-loopback names.
- **L-6 `patientInTenant` ignores soft-deleted/erased patients**: `lib/auth/tenant-refs.ts:21-29` has no `is_deleted=false`,
  so new visits, waitlist entries and consents can reference an erased (DPDP) patient of the same clinic. The `/api/v1` paths
  do filter `is_deleted`.
- **L-7 Tenant-ref check is check-then-insert (TOCTOU)**: this is only meaningful if a patient or visit can change tenant or
  be hard-deleted in the window. Both are prevented by RLS `WITH CHECK` and the FK. The composite FKs (V2-05 P1-02) are the
  real fix. No action now.
- **L-8 AI-06 L1 grep evasions** (policy, not security): `const S = Sparkles; <S/>`; default imports of a sparkle icon path;
  "AI" copy held in `.ts` constants and rendered by a `.tsx` (L1-R5 reads `.tsx` only). L1-R6 does scan `.ts`.

### Info
- "Reserved +91 90000 0xxxx range" (`scripts/seed-local-dev.ts:10`, `tests/e2e/support/m0-data.ts:27`): India has no reserved
  fictional mobile range, and 90000xxxxx are real allocations. This is safe while `MESSAGING_PROVIDER=dev`. If the PO ever runs
  `next dev` against the local stack with real MSG91 credentials, seeded reminders could reach real people. Reword the
  comments, and keep the messaging provider pinned in any local-stack dev profile.
- Playwright `test-results/` (traces on failure) are public artifacts for 14 days. Traces contain the per-run password
  (`fill`) and local-stack session cookies. These are ephemeral local credentials and synthetic data, so there is no impact.
  The bundles are noted here only so a future change to hosted-backed e2e does not inherit this.

---

## Checked and found sound (no finding)
- **Workflow injection / tokens**: no `${{ github.event.* }}` in any `run:`. Nightly `inputs.lane` is a `choice`, routed via
  env and a `case`. No `pull_request_target`, no `workflow_run`. Top-level `permissions: contents: read`;
  `persist-credentials: false` on every checkout. Only `report-failure` has `issues: write`, and it checks out no code.
  Repo default workflow permissions are `read`; `can_approve_pull_request_reviews: false`; `sha_pinning_required: true`.
  Every `uses:` is pinned to a full SHA.
- **Cache poisoning**: PR caches are scoped to `refs/pull/N/merge` (verified). Base-scope caches are written only by pushes to
  `feature/v2`. The `.next/cache` keys of the build and e2e jobs are distinct.
- **gitleaks installer** (`scripts/ci/install-gitleaks.sh`): https-only curl and a pinned SHA-256 for both the tarball and the
  checksums file, plus a cross-check. The only bypass would be to edit the script, which is a reviewed change. `--redact` on
  the SARIF.
- **e2e server lockdown**: `buildAppServerEnv` builds a fresh env object (no `process.env` spread; only PATH/HOME/TMPDIR/LANG/CI
  are inherited) and asserts it. `__NEXT_PROCESSED_ENV=true` verified against `@next/env` 15.5.28: `processEnv` returns early
  unless `forceReload`, and the only `forceReload=true` caller is the dev bundler. Build-output scan, BUILD_ID +
  public-env-hash stamp, port-3100 refusal, `reuseExistingServer: false`. The socket guard is preloaded through `NODE_OPTIONS`
  into build workers too. The browser `context.route`/`routeWebSocket` block fails the test on any non-loopback host, and every
  spec, including `auth.setup.ts`, imports `test` from `fixtures.ts`.
- **Test lane**: `.env` is never read (`.env.test` plus `supabase status` only); `envDir: false`. The guard rejects non-loopback
  URLs, hosted JWT issuers, `sb_*` keys, proxies, forbidden vars, and any value containing a hosted marker.
- **Seed loopback guard** (`scripts/seed-local-dev.ts:42-49`): no bypass found. Shell-set values are still validated (URL
  host set, `iss=supabase-demo` + role claim, hosted-marker scan). The generated password is printed once and never written
  to disk.
- **Committed evidence**: no JWTs, `sb_*` keys, emails or `+91` numbers in the evidence JSON/MD (grep). Screenshots reviewed
  (patients list, developer settings) show only "E2E Synthetic …" names and synthetic numbers. No keys are committed: the
  local keys come from `supabase status` at runtime. The only `eyJ`/`sb_` literals are fake ones in spec assertions.
- **Tenant-ref checks**: the helpers scope to `ctx.tenantId` (active tenant, not every membership). They return a boolean,
  and missing vs foreign ids give the same message, so there is no error oracle in the patched services. Patient is checked
  before doctor/visit in each service.
- **Audit allowlist expiry**: an expired waiver, one more than 90 days ahead, a stale waiver and a malformed waiver all fail.
  `npm audit` errors fail closed. Current waivers expire 2027-02-10 (exactly 90 days).
- **V2-01 regressions**: none. The range touches no `lib/` (except the new `tenant-refs.ts`), `app/`, middleware or
  migrations. Test edits in `review2/3-fixes-db`, `consultation-service-guards` and `rls.ts` are type-seam changes with the
  same assertions (`vitalsWithForgedRecorder` still forges `recorded_by`). The deleted specs were tautological, per plan.

## Required before gate
1. M-1: add the `visitInTenant` check in `uploadLabDocument` and a regression test.
2. M-2a: add per-field B-id variants to leg 3 and a valid file for FormData actions (or record a PO ruling deferring it).
3. M-2b: add a dual-membership leg, or record a PO ruling deferring it to V2-08 together with the listed RLS-only services.
4. M-3: apply ruleset (b) before merging into `feature/v2`.
