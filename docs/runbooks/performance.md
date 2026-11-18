# Runbook: performance reports (route JS and Lighthouse CI)

V2-06 plan 06-07 (P2-02, PWA-09, PWA_STRATEGY §3.9; rulings R-5, R-6). Both reports are **report-only** in V2-06.
V2-15 (readiness) makes them blocking. Agents run them locally against the loopback e2e stack only; nothing here
touches hosted Supabase, Vercel or any external service.

## 1. Route JS (bundle report)

**What it measures.** First-load JavaScript per app route, gzip level 9, kB = 1024 bytes. The script is
`scripts/ci/route-js.mjs`. Next 16 no longer prints a First Load JS column, and Turbopack writes no
`app-build-manifest.json`, so the script reads the manifests the build does write:

- **Framework root** = `rootMainFiles` of `.next/build-manifest.json`. Every app route loads these files.
- **Route total** = the root plus every `entryJSFiles` list of the route's
  `.next/server/app/<route>/page_client-reference-manifest.js`: the root layout, the nested layouts, the page and
  Next's built-in boundaries. Each distinct file counts once.
- **Route-specific** = total minus the framework root. This is the part a screen's own code controls.

**Where to read it.**

| Where | How |
|---|---|
| CI, every PR | `build` job: the table in the job summary, and the artifact `route-js` (`route-js.json`, `route-js.md`; 14 days) |
| Locally | `npm run build` (or `npm run e2e:build`), then `npm run ci:route-js -- --out <dir>` |
| M0 report | `npm run e2e:baseline` writes the same numbers into section 3 of the M0 README (`scripts/m0-baseline-report.mjs` imports the reader) |

**Budgets** live in `scripts/ci/route-js-budgets.json` (PWA_STRATEGY §3.9): 200 kB for Today `/` and Consult
`/consultation/[id]`, 150 kB for every other route. `/_not-found`, `/_global-error` and API routes are excluded. A
route over its budget shows `over`; the job still passes.

**Exit codes.** 0 = report written (report-only, whatever the sizes). 1 = `--enforce` and at least one route is over.
2 = a manifest or a chunk it names is missing or unreadable; the message names the file. A broken build never
reports as small, so exit 2 fails the CI step.

**Method difference to M0.** The M0 baseline (V2-02, Next 15 on webpack) summed `app-build-manifest.json` page +
enclosing layout chunks. The Turbopack numbers are not comparable 1:1 with it. The report header says so, and the
comparison stays with the research's same-build measurement (`06-RESEARCH.md`, "Bundle sizes now").

**The framework floor.** On Next 16.4.6 the root alone is **128.8 kB** (research, 2026-11-13; 06-07 measured the same
on its build). That leaves about 21 kB of route-specific JS under a 150 kB budget. Most dashboard routes are over 150 kB
today. That is expected and is not a V2-06 regression.

## 2. Lighthouse CI

**What it measures.** Lighthouse 12.6.1 (through `@lhci/cli` 0.15.1, devDependency, nightly only) on four routes:

| Route | Session |
|---|---|
| Login `/login` | signed out |
| Today `/` | owner |
| Patients `/patients` | owner |
| Consult `/consultation/<run visit>` | doctor (as in the M0 baseline) |

It uses Lighthouse's mobile defaults: simulated slow 4G, 4× CPU, one run per route. The assertions, all at `warn`,
carry the PWA_STRATEGY §3.9 numbers: LCP ≤ 2.5 s, TBT ≤ 300 ms, CLS ≤ 0.1, ≤ 2 font files.

**How it runs.** `tests/e2e/perf/lhci.spec.ts` in the Playwright project `perf-lhci`. Running inside the e2e run gives
it the guarded server on 127.0.0.1:3100, the run's synthetic seed and the signed-in storage states. Each run group
gets its config from `scripts/perf/lhci-config.mjs` (base: `scripts/perf/lighthouserc.base.json`):

- only loopback URLs; anything else throws;
- Lighthouse drives Playwright's own Chromium;
- Chrome runs with `--host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"`, so no request
  leaves the machine, Chrome's own background requests included;
- results go to `upload.target: "filesystem"` only, never Google's temporary public storage;
- signed-in groups get the role's `Cookie` header through `settings.extraHeaders`.

The config files and Lighthouse's working directory sit under the test's output directory and are deleted after the
run. `lhci` gets an explicit minimal environment (`PATH`, `HOME`, `TMPDIR`, `LANG`, `CI`).

**The scrub (the repository and its artifacts are public).** Lighthouse copies `extraHeaders` into every report,
including the JSON embedded in the HTML report. After `upload`, the spec rewrites every `.json`/`.html` file under
`test-results/lhci/`:

- it removes `configSettings.extraHeaders`;
- it redacts `Cookie`/`Authorization` values;
- it replaces any copy of a session value with `[REDACTED]`;
- it then asserts that no report contains a cookie value.

**When the spec fails.** Only for a tool error or a broken measurement: a missing report, a Lighthouse runtime error,
a signed-in route that ended on another URL (the cookie did not authenticate), an off-machine request that got an
answer, or a session value left in a report. It never fails on a score.

**Known effect of the lockdown.** Turnstile's script on `/login` cannot load (its host resolves to nothing). The login
score is measured without the widget, and the summary says so.

**Where to read it.**

| Where | How |
|---|---|
| Nightly (`lane == nightly`) | job `lhci`: the four-route table in the job summary; artifact `lhci` (scrubbed reports, `manifest.json`, `assertion-results.json`, `summary.json`, `summary.md`; 30 days). The artifact is uploaded only when `summary.json` exists, which the spec writes after the scrub checks pass |
| Locally | take the e2e lane lock (see the V2-06 plan, "Shared local stack and e2e lane"), then `npm run e2e:build && npm run perf:lhci`; read `test-results/lhci/summary.md` and open the `*.report.html` files |

## 3. The V2-15 switch (making both blocking)

1. In CI's `build` job, add `--enforce` to the route-js step.
2. In `scripts/perf/lighthouserc.base.json`, change each assertion from `warn` to `error`. Then update
   `lhci-config.mjs`, which today refuses any level other than `warn`, and its spec.
3. Have the LHCI spec fail when `lhci assert` exits non-zero, and move the job from the nightly lane to the PR lane if
   the PO wants it per PR.
4. **The budget question (R-5).** The 128.8 kB Turbopack framework floor makes 150 kB very tight for shell-only routes.
   Before switching, V2-15 brings measured numbers to the PO and either keeps the §3.9 budgets (and trims routes) or
   proposes new ones. A budget change needs the PO.
