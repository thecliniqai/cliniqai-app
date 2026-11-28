# V2-09e Caching and speed: verification

Results below come from tool output in `evidence/` and the linked CI run, never hand-typed.

## PR 1 CI evidence (09E-01..08 and review fixes)

| Run | Commit | Result | Source |
|---|---|---|---|
| CI [45647932485](https://github.com/thecliniqai/cliniqai-app/actions/runs/45647932485) | `6da8a89ceca750234385ab2921c6b2f3c44946c9` (PR head) | static, security, test, build, e2e all success; Vitest 426 files, 8420/8420, 0 failed, 0 skipped; pgTAP 75 files, 9559 tests, 0 failed, gate PASS; e2e desktop-chrome 798, iphone-15 108, pixel-7 327, pwa-ipados 7, setup 8 passed, **0 retried**, 0 flaky, 0 failed | `evidence/ci-pr1/ci-run.json`, `evidence/ci-pr1/ci-pgtap-report.tap`, GitHub run log |

The first attempt of the `test` job failed in the "Pre-pull pg_prove" step with `toomanyrequests: Data limit exceeded`
from public.ecr.aws (an infrastructure rate limit, not a test failure; pgTAP and Vitest were skipped). `gh run rerun
--failed` re-ran only that job and it passed. The e2e job of the first attempt was kept (success, 0 retried). The
Vitest counts come from the "Report gate" step of the rerun's log.

## PR 2 CI evidence (search and schedule; PR #20, not merged)

| Run | Commit | Result | Source |
|---|---|---|---|
| CI [46055228877](https://github.com/thecliniqai/cliniqai-app/actions/runs/46055228877) | `92340187261ada26114edbecf9438deb1ec38184` (PR head) | static, security, test, build, e2e all success; Vitest 435 files, 8709/8709, 0 failed, 0 skipped (vitest-report-gate PASS); pgTAP 81 files, 9892 tests, 0 failed, gate PASS; e2e desktop-chrome 832, iphone-15 122, pixel-7 361, pwa-ipados 7, setup 8 passed, **0 retried**, 0 flaky, 0 failed (project-scoped skips: desktop-chrome 9, iphone-15 5, pixel-7 340) | `evidence/ci-pr2/ci-run.json`, `evidence/ci-pr2/ci-pgtap-report.tap`, GitHub run log |

`scripts/phase-evidence.mjs --ci-run 46055228877` reported CI success at the commit above, with the five jobs and the
pgTAP gate as listed. The Vitest and Playwright counts come from the run log ("Report gate" and "Playwright run"
steps), as for PR 1.

PR 2 is not merged. The gate approval and the merge are the PO's.
