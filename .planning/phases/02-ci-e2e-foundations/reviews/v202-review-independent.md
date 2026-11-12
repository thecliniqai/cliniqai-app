# V2-02 independent review — `2695964..63cb713` (`v2/phase-02-ci-e2e-foundations`)

Reviewer: isolated Claude reviewer (fresh context). Read-only. I ran: `npm run typecheck` (exit 0), `npx eslint . --quiet` (exit 0), `gh run list/view`. I did not run Vitest or Playwright.

## Verdict: **approve-with-fixes**

The phase meets the roadmap acceptance on the HEAD commit. CI run 43220436353 at `63cb713` is green on all five required checks:
- Vitest: `files=98 tests=1753 passed=1753 failed=0 skipped/todo=0`.
- `guard-canary: PASS`: `guard-actions.spec.ts` exited 1 and named `features/__guard_canary__/actions.ts#listCanaryPatients`.
- Playwright: `120 passed`, 0 retried. The expected failures are only F-01, F-04, P1-03, P1-07 and the network-block self-test.
- The M0 report is committed.

The CI design is sound:
- SHA-pinned actions, read-only token, no secrets, no `pull_request_target`.
- `persist-credentials: false`, timeouts on every job.
- The report gate fails closed, the audit and AI-L1 allowlists expire, and gitleaks runs over the full history.

The product changes (`lib/auth/tenant-refs.ts`) are correct for legitimate users. One fix is needed before merge (F1): it is a cross-tenant reference write of exactly the OA-4 class, and the guard engine missed it for a structural reason (F2).

---

## Findings

### F1 — HIGH — `uploadLabDocument` stores a caller-supplied `visit_id` without checking its tenant (the OA-4 class, still open)
- **Where:** `features/labs/service.ts:57`, `:76` and `:117`.
  - Line 57 reads `visit_id` from the FormData.
  - Line 76 checks that the patient belongs to the tenant (`.eq("tenant_id", session.tenantId)`, lines 80-84) but never checks `visit_id`.
  - Line 117 inserts it: `visit_id: visit_id || null`.
  - The schema (`features/labs/schema.ts:5`) only requires a uuid.
- **Scenario:** A tenant-A doctor or owner (`patients:edit`) uploads a document for their own patient with tenant B's visit uuid in `visit_id`. The insert creates a tenant-A `patient_documents` row that points at B's visit. This is the same integrity defect OA-4 fixed in createVisit, consent, referrals and the other services. `visit_id` is also not checked against `patient_id`, so a document can link to another of the clinic's patients' visits.
- **Fix:**
  - Before the upload, add `if (visit_id && !(await visitInTenant(ctx, visit_id, patient_id))) return { success:false, error:"Visit not found." }`.
  - Add a case to `tests/security/cross-tenant-refs.spec.ts`.
  - Add `patient_documents.visit_id` to the V2-05 P1-02 composite-FK list in OA-4.

### F2 — MEDIUM — Guard leg 3 (cross-tenant) passes vacuously when the forged arguments fail validation before the write
- **Where:**
  - `tests/security/guard/engine.ts:298-314` (`argsFor`) and `:252-284` (`forgedObject`).
  - `:374-387` (`crossTenantActionLeg` checks only that no B value comes back).
  - `tests/security/guard-actions.spec.ts` leg 3.
- **Scenario:**
  - For FormData actions, the forged object has no `file`. So `uploadLabDocument` returns "Please select a valid document file" at `features/labs/service.ts:35`, before the patient or visit lookups and before the insert.
  - The leg reports no violation. `aRowsReferencingB` finds nothing because nothing was written.
  - This is why F1 survived the enumeration that found the OA-4 defects. The same holds for any action whose zod schema rejects the generic forged object (enum or required fields the forger does not fill). For those, leg 3 proves nothing about tenant derivation.
- **Fix (pick one or both):**
  - Record, per action, whether leg 3 returned a *validation* failure (fieldErrors, "Validation failed", "Please select…"). Require a manifest annotation (`leg3: "reaches-write"` / `"validation-only: <reason>"`) so a vacuous pass is explicit and reviewed.
  - Give the forger per-action overrides, e.g. a synthetic 1-byte PDF `File` for FormData with `file`, and valid enum values.
  - At minimum, add a positive control: the same args with tenant-A ids must reach success for the write actions. `cross-tenant-refs.spec.ts` already does this for createVisit (line 98). The engine does not.

### F3 — MEDIUM — Inline (function-level) `"use server"` actions are invisible to the inventory, so they bypass the guard test
- **Where:**
  - `scripts/inventory-server-actions.ts:131-137` (`hasUseServerDirective` checks only the module prologue).
  - `buildInventory` lines 382-386.
  - The ESLint P0-01 gates match only `Program:has(> ExpressionStatement[directive="use server"])` (`eslint.config.mjs`).
- **Scenario:**
  - A developer adds `<form action={async (fd) => { "use server"; await createClient()... }}>` to a page under `app/(dashboard)`. Next exposes it as a server action endpoint.
  - The inventory never lists it, so the guard manifest completeness check, the guard legs and the CI canary all stay green.
  - There are none in the tree today (grep found only comments). But the roadmap acceptance "adding an unguarded server action makes the guard test fail" holds only for module-level actions.
- **Fix:**
  - Have the inventory flag (exit 1) any `"use server"` directive that is not at module level in the scan dirs. Alternatively, add an ESLint `no-restricted-syntax` rule on `:function > BlockStatement > ExpressionStatement[directive="use server"]`.
  - Add a fixture to `lint-fixtures/p0-13/`.

### F4 — LOW — `test.fail()` expected failures do not pin the failure reason, so an unrelated breakage keeps them green forever
- **Where:**
  - `tests/e2e/m0/register-patient.spec.ts:63`
  - `tests/e2e/m0/book-appointment.spec.ts:101`
  - `tests/e2e/m0/consult-rx-finish.spec.ts:121`
  - `tests/e2e/journeys/journey-08-role-restrictions.spec.ts:41`
- **Scenario:**
  - RL-19's promise is that the test turns red when the bug is fixed. But any failure counts as the expected failure.
  - Example: the F-01 test fails at `registerPatient` if the "Register Patient" link is hidden for receptionists, a label is renamed, or a step times out. It fails in 16.7 s in CI, which looks like the 15 s URL timeout, but the cause is not asserted.
  - If the shared helper breaks for another reason, or PO-3 lands while the locator also drifts, the test stays green. The fix then goes unnoticed and the annotation is never removed.
  - The CI summary (`scripts/ci/playwright-summary.mjs`) does not list why expected-failure tests failed.
- **Fix:** In each `test.fail` test, assert the current buggy symptom up to the point of divergence before the correct-outcome assertion. For example, F-01: the Save click shows the forbidden error and no row exists. Or add a sibling passing test that characterises the bug as it is. Alternatively, an `afterEach` can check that `testInfo.errors[0].message` matches the expected assertion. Have the summary print the first error line of each expected failure.

### F5 — LOW — The Vitest report floor (1100) is ~650 below the actual count (1753), so whole security specs could disappear unnoticed
- **Where:** `scripts/ci/assert-vitest-report.mjs:12-17` and `:22`. The run at `63cb713` has 1753 tests.
- **Scenario:** Any change that drops up to 653 tests still passes the gate. That covers a glob change, a deleted `tests/security/guard-*.spec.ts` or `cross-tenant-refs.spec.ts`, or an inventory regression that halves the cases. The guard-actions spec does have its own `cases.length > 100` check.
- **Fix:** Raise the floor to the measured count less a small margin (for example 1740), with the arithmetic, as the file's FLOOR history requires. Optionally assert that a short list of required spec files is present in `testResults` (the guard specs, `p0-01-action-sweep`, `cross-tenant-refs`).

### F6 — LOW — The M0 report location and the FMP appendix deviate from plan 02-03b, and no ruling covers it
- **Where:**
  - The plan says `docs/v2/m0-baseline/**` and the FMP appendix v1 cells are filled by the script (`02-PLAN.md:421-429`).
  - Delivered: `.planning/phases/02-ci-e2e-foundations/evidence/m0-baseline/` (`scripts/m0-baseline-report.mjs:29`).
  - `docs/` is unchanged in the range, so `--update-fmp` was not run, although README §6 says the "Walk-in, existing patient" row qualifies.
- **Fix:** Either run with `--update-fmp` and move or copy the report to `docs/v2/m0-baseline/`, or record an OA ruling for the new location and the deferred FMP cells. The roadmap acceptance is only "the M0 baseline report is committed", which is met.

### F7 — LOW — The phase's committed CI evidence is not at the final SHA
- **Where:** `.planning/phases/02-ci-e2e-foundations/evidence/02-01/ci-run.json` records run 43198582433 at `77bdfb8`. At that commit the `e2e` job ran in 6 s, before the guard suite, the e2e scaffold and the flows existed.
- **Fix:** Regenerate it with `node scripts/phase-evidence.mjs <dir> --ci-run 43220436353` (green at `63cb713`) or with the run at the final merge SHA, as DoD 5 requires.

### F8 — LOW — CI reliability: image pulls rate-limited, no retry
- **Where:** `.github/workflows/ci.yml:112` and `:211`. Both `test` and `e2e` run `npx supabase start`, each pulling the full image set. Run 43219924489 (`ade531f`) failed `e2e` with `toomanyrequests: Rate exceeded`, followed by a port-bind error.
- **Fix:** Add a retry wrapper (stop, then start again once). Consider caching images, or pinning the registry the CLI uses. Without one, required checks will flake red under load.

### F9 — INFO — Smaller observations (no action required for the gate)
- **Unruled UI change:** The phase invariant (`02-PLAN.md:23-26`) allows only the auth-page a11y fixes, and OA-1 covers only the login-page sparkle. The diff also removes `Sparkles` icons from `components/consultation/prescription-builder.tsx` and `components/queue/checkout-drawer.tsx`. This is purely visual and AI_STRATEGY-consistent, but it should be noted under OA-1.
- **Vacuous receipt-PDF probe:** `tests/e2e/journeys/journey-09-clinic-isolation.spec.ts` (receipt-PDF probe) sends `tenantB.visitId` to `/api/invoices/[id]/receipt-pdf`. That id can never match an invoice, so it is always 404 regardless of isolation. `guard-routes.spec.ts` covers the invoice case properly with `b.invoice`, so this is redundant rather than a gap. Seed a B invoice or drop the probe.
- **Doctor check accepts any member:** `memberOfTenant` (`lib/auth/tenant-refs.ts:49-57`) accepts any member, not only doctors, as `doctor_id`. That is fine for tenant isolation and matches the v1 behaviour. The role check for doctor references belongs to P1-02 or a later phase. Memberships RLS (`000001_foundation.sql:68-72`) lets every member read the clinic's memberships, and `unique_user_tenant` makes `.maybeSingle()` safe. No regression for receptionists booking against a doctor. `cross-tenant-refs.spec.ts:98` has the positive control.
- **Network block covers only fixture contexts:** The e2e network block (`tests/e2e/fixtures.ts`) applies only to fixture-provided contexts. No spec calls `browser.newContext()` today. Consider an ESLint `no-restricted-syntax` rule for `newContext` under `tests/e2e/**`.
- **Nightly cache key:** The nightly Playwright cache key (`nightly.yml`) differs from the PR one and the browsers are always reinstalled. This is harmless.

---

## What I checked and found sound
- **CI workflow (`ci.yml`):**
  - Top-level `permissions: contents: read` and SHA pins with tag comments on every `uses:`.
  - No `pull_request_target` or secrets, so fork PRs are safe.
  - Gate steps use `if: !cancelled()`, so the report gate runs after a red Vitest step.
  - `supabase stop` runs under `if: always()`, and every job has a timeout.
  - `.next/cache` is keyed on the lockfile and source hash, and the Playwright cache on the version.
  - No step can silently pass: the summary steps are report-only by design, while the report gate, canary, audit and AI-L1 steps exit non-zero.
- **Report gate (`assert-vitest-report.mjs`):** fails on any non-passed status, a missing report (exit 2), `success!==true` and counter disagreement. 0 skipped is satisfied (`skipped/todo=0`).
- **Audit gate:** fails closed on npm error or non-JSON output. Expired, stale and >90-day waivers fail. Four waivers, each with an owner phase.
- **AI-L1:** parser-based copy extraction, L1-R6 cannot be waived, and expired or stale exceptions fail. Fixtures are covered by `tests/ci/ai-l1-greps.spec.ts`.
- **Guard enumeration:**
  - Completeness runs both ways (missing and stale).
  - The static guard must match the manifest.
  - Legs 1, 2 and 4 refuse with an access log on the real JWT client, so any table read before the refusal fails.
  - Global row counts are compared per batch (`fileParallelism: false` makes this deterministic).
  - B snapshots are byte-identical and no A row references a B id.
  - Route categories are justified per kind.
  - Canary: in CI it re-proves only the completeness leg, which is what the roadmap acceptance asks. The in-place `guard-canary.spec.ts` also covers the permission, unauth and route legs.
- **Product changes:**
  - createVisit (and bookAppointment and promoteWaitlistEntry through it), addToWaitlist, the three consent writes, recordFollowUp, addConsultationDiagnosis, createReferral (now tenant-filtered on the patient), createVisitInvoice and createScheduleBlock.
  - All checks use explicit `tenant_id = ctx.tenantId`, so they are correct on the service-role API-key path too. They give id-free errors.
  - Legitimate flows pass: the CI flows `consult-rx-finish`, `checkout-collect` and `book-appointment` are green.
- **Test deletions:**
  - `cabin/navigation-roles`, `queue/status-actions`: helpers defined inside the spec and asserted against themselves (tautological).
  - `ops/backup-restore`: doc-grep plus a snapshot of rows it had just inserted.
  - All justified under T-12. The one real case was moved to `settings/profile-and-credentials`.
- **Coverage:** v8, report-only, no thresholds, `reportOnFailure`. The include adds `components/**` beyond the plan, which is harmless.
- **Evidence integrity:** the M0 README and JSON are generated by `scripts/m0-baseline-report.mjs`, pinned to commit `ade531f`, with a dirty-tree marker (not set). The identical `billing-register` and `billing-reports` screenshots are correct, because `/billing/register` redirects to `/billing/reports`.

## Acceptance checklist

| Item | Status | Evidence / gap |
|---|---|---|
| **V2-02 acceptance 1:** PR lane green, 0 skipped in DB lane | ✅ | Run 43220436353 @ `63cb713`: all 5 jobs pass; `tests=1753 … skipped/todo=0` |
| **V2-02 acceptance 2:** unguarded server action fails the guard test | ✅ (module-level) / ⚠ | CI canary PASS. Inline `"use server"` bypasses it (F3) |
| **V2-02 acceptance 3:** M0 baseline report committed | ✅ / ⚠ | `.planning/.../evidence/m0-baseline/` (tool-generated @ `ade531f`). Location and FMP differ from the plan (F6) |
| **P0-11:** pipeline (typecheck, lint, unit+DB, build, audit, gitleaks), branch protection, CODEOWNERS | ✅ | `ci.yml`; `evidence/github-settings/*.json`; `.github/CODEOWNERS`. Final-SHA CI evidence not yet recorded (F7) |
| **P0-13:** guard test over every action and route, plus P0-01…05 regressions | ✅ / ⚠ | `guard-actions`/`guard-routes`/`guard-canary` green. Leg 3 is vacuous on validation-rejected actions (F2), which let F1 through. Inline actions are not enumerated (F3) |
| **P1-27:** Playwright scaffold, 6 characterisation flows, axe, type-checked tests, tautology removal | ✅ / ⚠ | 6 flows and journeys 1/8/9 green in CI. R8 axe spec present. `tsconfig.tests.json` in typecheck. Deletions justified. Expected-failure reasons are not pinned (F4) |
| **P1-41:** coverage reporting, report-only | ✅ | `--coverage.enabled` in the same run; `coverage-summary.mjs` never fails; artifact uploaded (lines 39.38%) |
| **PWA-08a:** Desktop, Pixel 7, iPhone 15 in the PR lane; full matrix nightly | ✅ (PR) / ⏳ (nightly) | PR lane: desktop-chrome 61, pixel-7 45, iphone-15 9 passed. Nightly projects are defined; a scheduled-run link is still owed (plan 02-03a acceptance) |
| **AI-06 L1:** AI copy and route greps | ✅ | `scripts/ci/ai-l1-greps.mjs` in `static`; fixture spec; time-boxed allowlist only |
| **DoD:** typecheck / lint | ✅ | `npm run typecheck` exit 0; `npx eslint . --quiet` exit 0 (local, this review) |

## Required before merge
1. F1 (fix plus regression test).
2. F2: at least make vacuous leg-3 passes visible, for example with the manifest annotation or a positive control, so the next OA-4-class defect is not missed the same way.
3. F3: a lint or inventory flag on non-module-level `"use server"`.
4. F7: refresh the CI evidence at the final SHA.

F4, F5, F6 and F8 can land in this phase or be recorded with an owner.
