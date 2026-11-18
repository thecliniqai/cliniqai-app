# 06-07 record: route-JS report, M0 report fix, Lighthouse CI (report-only)

Plan: `06-PLAN.md` § 06-07 (Wave 2, no G2-D; P2-02, PWA-09, PWA §3.9; rulings R-5, R-6). Branch
`v2/phase-06-design-system-pwa-shell`, shared wave-2 worktree, plan base `ba69ebd`, plan head `87dc215`. Every number
below is tool output from `evidence/06-07/` (file named per row). The evidence runs used a **clean detached worktree at
`87dc215`**, outside the shared worktree, so the partners' uncommitted work is not in them: `npm run e2e:build`,
BUILD_ID `FUuw6Nco310ZwwUEH_jy-`.

## What changed

| Area | Change | Files |
|---|---|---|
| Route-JS report | `scripts/ci/route-js.mjs` reads Turbopack's manifests. **Framework root** = `rootMainFiles` of `.next/build-manifest.json`. **Route total** = root ∪ every `entryJSFiles` list of the route's `page_client-reference-manifest.js`, which is evaluated in a `node:vm` sandbox with a fresh `__RSC_MANIFEST`, no Node globals and string code generation off. Size is gzip -9 per distinct file, kB = 1024. Output: `route-js.json` + `route-js.md`, with the method note "not comparable 1:1 with the M0 webpack numbers". Budgets come from `route-js-budgets.json`: 200 kB for `/` and `/consultation/[id]`, 150 kB otherwise; `/_not-found`, `/_global-error` and API routes are excluded. Exit codes: 0 report-only, 1 `--enforce` with an `over`, 2 a missing or unreadable manifest or chunk (the message names the file). `--summary <file>` appends the table. | `scripts/ci/route-js.mjs`, `scripts/ci/route-js-budgets.json`, `lint-fixtures/route-js/**`, `tests/ci/route-js.spec.ts` |
| M0 report | `routeJs(nextDir)` reuses the reader in place of the missing `app-build-manifest.json`. Section 3 shows the framework root, then total, route-specific, files, budget and status per route. The module no longer runs the report when imported. | `scripts/m0-baseline-report.mjs` |
| CI `build` job | After `npm run build`: `node scripts/ci/route-js.mjs --out route-js --summary "$GITHUB_STEP_SUMMARY"`, then the `route-js` artifact (14 days). A budget never fails the job; a broken build (exit 2) does. | `.github/workflows/ci.yml`, `.gitignore` (`/route-js`, `.lighthouseci/`) |
| Lighthouse CI | `@lhci/cli` **0.15.1** exact devDependency (the plan's pin; lighthouse 12.6.1). `lhci-config.mjs` builds one config per run group from `lighthouserc.base.json`: loopback URLs only (anything else throws), Playwright's Chromium, `--host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"`, `--no-sandbox` on CI only, filesystem upload, the four §3.9 assertions at `warn` (any other level throws), and the role's `Cookie` in `extraHeaders`. The scrub removes `extraHeaders` and redacts `Cookie`/`Set-Cookie`/`Authorization` values in JSON and in the HTML report's embedded JSON. It also replaces free-text copies of the session values, then throws if one survives. | `scripts/perf/{lhci-config.mjs,lighthouserc.base.json}`, `tests/ci/lhci-config.spec.ts`, `package.json`/lock |
| LHCI spec | `tests/e2e/perf/lhci.spec.ts`, project `perf-lhci` (`testMatch /perf/`, `retries: 0`; ignored by every PR, nightly and design project). It runs Login signed out, Today and Patients as owner, and Consult as doctor (the run's visit, as in M0), in three `lhci collect` calls (`--additive` after the first), then `assert` and `upload`. `lhci` gets a minimal env (`PATH`, `HOME`, `TMPDIR`, `LANG`, `CI`). The configs and `.lighthouseci/` live under the test's output dir and are deleted in `finally`, then `test-results/lhci/` is scrubbed. The test fails on a tool error, a missing report, a runtime error, a signed-in route whose final URL differs (cookie not accepted), an answered off-machine request, or a surviving session value or `extraHeaders` key. Writes `summary.json`/`summary.md` (route patterns, no visit id). | `tests/e2e/perf/lhci.spec.ts`, `playwright.config.ts`, `package.json` (`perf:lhci`, `ci:route-js`) |
| Nightly | Job `lhci` (lane `nightly` only; SHA-pinned actions, no secrets, read-only token): `npm ci`, Chromium, local stack, `e2e:build`, `perf:lhci`. It writes the summary table to the job summary and uploads artifact `lhci` (30 days) only if `summary.json` exists, which is written after the scrub checks. `report-failure` needs it. | `.github/workflows/nightly.yml` |
| Runbook | Reading both reports, the method difference to M0, the 128.8 kB framework floor, the V2-15 switch and the R-5 budget question. | `docs/runbooks/performance.md` |

## Evidence (tool output)

| Check | Result | File |
|---|---|---|
| Route JS on the clean build | framework root **128.8 kB** gz (6 files), same as the research; `/` 158.3, `/consultation/[id]` 213.0, `/login` 234.3, `/patients` 161.7 kB; **19 of 24 routes over** budget; exit 0. `--enforce` exits 1, listing the 19 | `route-js/{route-js.json,route-js.md,run.txt}` |
| M0 report section 3 on the same build | before (plan base script): `available: false`, "`.next/app-build-manifest.json` not found"; after: 24 routes with totals, budgets and status | `m0-route-js-before-after.md` |
| Lighthouse CI, `npm run perf:lhci` (lane lock held) | 6 passed (5 setup + 1 LHCI) in 1.0 min, 0 retries. Columns are LCP, TBT, CLS, font files, perf score: `/login` 3635 ms, 22 ms, 0.021, 0, 90; `/` 2224, 9, 0, 0, 99; `/patients` 2310, 1, 0, 0, 98; `/consultation/[id]` 2623, 9, 0, 0, 97. Warnings (report-only): LCP on `/login` and Consult. An earlier run on the shared worktree's build gave the same picture (LCP 3488, 2618, 2318, 3319 ms) | `lhci-summary.json`, `perf-lhci-run.txt` |
| Lockdown works | `/login`: the only off-machine request, `challenges.cloudflare.com` (Turnstile), failed (status -1); the other routes made none | `lhci-summary.json` `blockedOffMachineRequests` |
| Scrub works | 12 files in `test-results/lhci/`: none holds an `"extraHeaders"` key or the auth cookie name; the spec asserted no cookie value in any file | `lhci-output-scan.json` |
| Dependency | `@lhci/cli@0.15.1` + 280 transitive entries; no install scripts, lock integrity = registry for all, `npm audit signatures` 912 verified / 0 invalid / 0 missing. The script **exits 1** on 6 deprecated transitive versions (see Open). The lock check (`lock-linux-check.sh --fix`, then check) passes; lock diff vs base: 281 entries added, 0 removed or changed except the root `devDependencies` | `../package-legitimacy.json` `plans."06-07"` |
| Prod audit gate | `npm run ci:audit` PASS (2 high, both waived, unchanged) | session log |
| gitleaks (docker `zricethezav/gitleaks:v8.30.1`, full history) | "no leaks found" (771 commits); range `ba69ebd..87dc215` "no leaks found" | session log |

## Tests that fail without the change

- `tests/ci/route-js.spec.ts` (10 tests). Before this plan the script and the M0 `routeJs` export did not exist, and
  importing the old M0 script ran the whole report. The cases cover: root counted once; per-route totals equal the
  fixture's known gzip -9 sizes; `over` with exit 0; `--enforce` exit 1; `--summary` append; missing
  `build-manifest.json` → exit 2 naming the file; missing chunk → exit 2; a manifest touching `process` → exit 2; the
  repository budgets equal §3.9; M0 `available: true` on the fixture and `available: false` with the missing file.
- `tests/ci/lhci-config.spec.ts` (11 tests). Before, no builder or scrub existed. The cases cover: filesystem upload,
  loopback URLs, the resolver rule, Chromium path; the Cookie header goes to `extraHeaders` and `--no-sandbox` appears
  only on request; all four assertions are `warn` with the §3.9 numbers and `error` is refused; 4 non-loopback URL
  shapes throw; the cookie header covers only the measured host; the scrub of a fixture LHR, and of `.json`, `.html`
  and nested files on disk.
- `perf-lhci` run: four LHR files and no cookie value in any report (row above).

## Suite results (local)

| Lane | Result |
|---|---|
| `npm run typecheck` | 06-07 files clean. In the shared worktree the only error is `tests/pwa/icons.spec.ts(12,1)` TS2578, an uncommitted 06-05 file (wave partner), not 06-07 |
| `npx eslint .` | 0 errors, 462 warnings (pre-existing report-mode rules; 06-07 files: 0) |
| `npm run inventory` | exit 0, 0 flagged |
| `npm run ci:ui-policy`, `npm run ci:ai-l1`, `node scripts/ci/workflow-policy.mjs` | PASS, PASS, PASS (7 workflows) |
| 06-07 Vitest specs (`tests/ci/route-js.spec.ts`, `tests/ci/lhci-config.spec.ts`) | 2 files, 21 tests pass |
| Full Vitest lane, clean worktree at `87dc215` (stack at migration 000076) | 253 files, **4915 / 4919 pass**. The 4 failures all come from the shared stack carrying V2-05's migrations 000075-000076, which this branch lacks (the shared-stack rule: recorded, nothing changed). None of them exercises a 06-07 file: <br>• `tests/ci/hosted-dump-diff.spec.ts` (2): the local schema dump drifts from the branch's migrations. <br>• `tests/ops/drill-lib-db.spec.ts` `drill_authz_matrix`: the RLS matrix generated from the branch expects `public.patients insert` ok for admin/doctor of A, and the newer stack denies it. <br>• `tests/billing/invoice-totals-db.spec.ts` "adding and removing charges…": the add-charge call is refused on the newer schema. <br>The 06-01a note's pre-existing `review2-fixes-db` failure no longer fails on this stack. `schema-snapshot` and the readiness probe pass (`vitest-full-clean-tree.txt`) |
| `npm run e2e:build && npm run e2e:pr`, clean worktree at `87dc215` | **222 passed, 9 skipped, 0 failed, 0 retried** (desktop-chrome, Pixel 7, iPhone 15; the ✘ rows in the log are the annotated `test.fail()` v1 gaps) (`e2e-pr-clean-tree.txt`) |
| Same lanes in the shared worktree | 265 passed, 22 failed, 38 skipped. All 22 failures are in the partners' uncommitted work: `tests/e2e/pwa/{04,05}-*` and `auth/signout.spec.ts` (06-05's sign-out/purge work in progress), `tests/e2e/design/route-states-axe.spec.ts` and `shell/route-states.spec.ts` (06-04a). None touches a 06-07 file, and the clean-tree run above has 0 failures |
| `npm run perf:lhci` | 6 passed, twice (shared build, then the clean build); the first attempt failed at import (deviation 5) |
| Local stack | Up, with migrations through **000076** applied by V2-05. This branch has 000074, which is expected under the shared-stack rule. 06-07's tests seed their own per-run tenants (Playwright and Vitest global setup), so `seed:local` was not needed and not run |

## Deviations

1. **Run groups instead of one config.** The plan describes one config with the role's cookie. Three routes need
   two different roles (Today and Patients as owner, Consult as doctor, as in M0) and Login needs none, so the spec
   runs three `lhci collect` calls into one `.lighthouseci/` (`--additive`), then one `assert` and one `upload`.
2. **`numberOfRuns: 1`** (LHCI default 3). The run is report-only, and one run keeps the nightly job short (about
   1 min locally). V2-15 can raise it when the assertions become blocking.
3. **Categories** are performance, accessibility and best-practices (`onlyCategories`). The plan names only the
   performance metrics. Accessibility comes at no extra cost and is shown in the summary.
4. **`--no-sandbox` on CI only.** GitHub's ubuntu-24.04 runners restrict the unprivileged user namespaces that
   Chrome's sandbox needs. Pages are loopback-only with synthetic data. Locally Chrome keeps its sandbox.
5. **`lhci-config.mjs` has no `import.meta`.** Playwright compiles the spec's `.mjs` import to CommonJS, so the base
   config path is passed in (`BASE_CONFIG_REL`). The first `perf:lhci` run failed on exactly this, before any
   Lighthouse call. Fixed and re-run; it is not a flaky test.
6. **Nightly artifact gate.** The artifact uploads only when `summary.json` exists, so a run cut off between
   `upload` and the scrub can never publish an unscrubbed report. This is stricter than the plan's "upload after the
   scrub".
7. **`.gitignore`** also ignores `/route-js` (the CI step's output directory at the repo root).
8. **`--before=2026-11-07`** for the install: transitive dependencies resolve only to releases at least 7 days old
   (research rule). The direct pin is the plan's 0.15.1.

## Open

- **PO 06-P4.** The legitimacy script exits 1 only on deprecations: `inflight@1.0.6`, `rimraf@3.0.2`,
  `rimraf@2.7.1`, `glob@7.2.3` (×2) and `uuid@8.3.2`, all transitive under `@lhci/cli@0.15.1`. The full dev audit
  adds `basic-ftp`, `extract-zip`, `tmp` and `uuid` advisories (low 0→2, moderate 11→12, high 8→20 by package count).
  None of the vulnerable paths runs here: no proxy env (`basic-ftp` comes via `proxy-agent`), no browser download
  (`extract-zip`; `chromePath` is given), fixed temp use (`tmp`), v4 ids only (`uuid`). The PR gate covers production
  dependencies and is unchanged. The PO either accepts 0.15.1 or moves to 0.16.0 (lighthouse 13, `uuid` 14; [SUS]
  too-new per the research). Owner: PO at 06-P4. Recorded in the wave notes.
- **Evidence build.** The evidence comes from the clean build at `87dc215`. Phase close regenerates
  `evidence/06-07/route-js` and the LHCI summary on the final tree (plan, "Phase close").
- **CI proof pending.** The `build`-job step and the nightly `lhci` job (`--no-sandbox` on ubuntu-24.04) first run on
  GitHub when the orchestrator pushes. The workflow policy checker passes (7 workflows).
- **Budget question for V2-15 (R-5).** 19 of 24 routes exceed §3.9, and the framework floor is 128.8 kB. This is
  report-only by design; see `docs/runbooks/performance.md` §3.
- **Login LCP** (3.6 s simulated) and Consult LCP (2.6 s) exceed 2.5 s. This is report-only input for V2-15 and the
  screen-owning phases. No Low is raised against 06-07.
