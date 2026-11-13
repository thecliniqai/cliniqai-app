---
phase: 04
plan: 04-07c
subsystem: ops review fixes (workflow policy, backup authentication, restore schedules, alert noise)
status: complete
requirements: [FT-02, P1-25 (alerts part)]
triage: 04-07-REVIEW-TRIAGE.md (M-POLICY, M-BACKUPAUTH, M-RESTORE, 04-07c Lows, runner-secret ruling)
plan_head_before: 64c455c
commits: [17634ba, 624f47a, 448a769, 838d4bd, evidence commit]
---

# 04-07c record: ops review fixes

**Outcome:** every 04-07c item of the triage is fixed with a test that fails without it. The reviewer's five
workflow-policy bypass fixtures passed the policy at `0dc606b` and are refused now. A tampered or planted archive is
refused by the restore before `age -d`. A dump holding a psql meta-command is refused before any SQL runs. A restore
re-creates the nine pg_cron schedules, and the drill checks that it does. The alert cooldown applies per rule. A
`workflow_run` spoof of the backup alert is refused by the job condition and by the step. Migration **000042**
(`000042_ops_review_fixes.sql`) is committed after 04-07a's 000041. Nothing hosted was contacted, no workflow was
dispatched, no `--linked`/`db push` was used, no `.env*` file was read, and no dependency was added.

## Triage item → commit → test

| Triage ID (source) | Fix | Commit | Test that fails without it |
|---|---|---|---|
| **M-POLICY** (C M-1) | `workflow-policy.mjs`: `environment-literal` (no `${{ }}` Environment), `environment-known` (only `staging`, `staging-readonly`, `staging-backup`, lower case; every comparison lower-cased), `no-dynamic-secret` (`secrets` only as `.NAME` / `['NAME']`), any job with an Environment makes the workflow a staging workflow (refuses `workflow_run`/PR triggers next to it) | `17634ba` | `tests/ci/workflow-policy.spec.ts` › "environment, secret-name and workflow_run bypasses (04-07c)": the four M-1 fixtures `lint-fixtures/workflows/bypass-{environment-expression,environment-matrix,environment-case,readonly-case}.yml` exit 1 naming each rule; the same bypasses on the committed `backup.yml`; any Environment ⇒ staging rules. Before/after: `evidence/04-07c/workflow-policy-bypass-before-after.txt` (all exit 0 at `0dc606b`) |
| **M-BACKUPAUTH** (C M-2) restore side | `run.sh --expect-sha256 <hex>` required for `archive` and `--decrypt-only`, mismatch refused before `age -d`; `ops/restore-drill/sql-guard.ts` (psql-lexer view: quotes, E'' strings, dollar quotes, comments, COPY data to `\.`) refuses any meta-command, `COPY … PROGRAM` and text after `COPY … FROM stdin;`; evidence checks `archive_digest`, `sql_guard`, self-test `tampered_archive_refused` | `624f47a` | `tests/ops/restore-guards.spec.ts` (tampered and planted archives refused before decrypt in both modes; `\! touch <marker>` dump refused before restore, marker never created, no stack start; 12 guard refusal shapes; pg_dump shapes pass); `tests/ops/drill-evidence-and-workflows.spec.ts` (missing checks fail). Negative proof: `evidence/04-07c/restore-guards-negative-proof.txt` |
| **M-BACKUPAUTH** record side | `ops.backup_runs.archive_sha256` (`^[0-9a-f]{64}$`, required on new `ok` rows, NOT VALID for old rows); `backup.sh` writes it to the row, to `BACKUP_DIGEST_OUT` (`backup.yml` artifact `archive-digest.json`) and to the job summary; the self-test restores only the archive whose digest the row holds | `448a769` | `tests/ops/backup-runs-db.spec.ts` (ok row without digest / malformed digest refused); `tests/ops/backup-roundtrip-db.spec.ts` (row, digest file and summary carry the archive's SHA-256); self-test `evidence/04-07c/restore-drill-selftest.json` (`archive_digest`, `tampered_archive_refused` true) |
| **M-RESTORE** (IND M4) | `ops.ensure_schedules(p_activate_kick)`: idempotent re-creation of the nine schedules, `jobs-kick` inactive unless `true`; drill checks 7-9 run it in the drill's rollback (13 pgTAP checks); runbook §8 steps 4-5 | `448a769` | `tests/ops/ensure-schedules-db.spec.ts` (matches the migrated stack; creates nine with kick inactive; idempotent; repairs drift; `(true)` activates; postgres only); `tests/ops/restore-drill-checks-db.spec.ts` (13 ok; a function that forgets a schedule or activates the kick fails the drill); self-test `pgtap=13` on the real restore |
| L-1 (C L-1) cooldown per rule | `ops.evaluate_alerts()`: a new notification also needs the rule's previous episodes' last notification (sent or tried) outside the cooldown; a deferred episode is notified at the first evaluation after it; index `alerts_rule` | `448a769` | `tests/jobs/alert-review-fixes-db.spec.ts` › L-1 (the reviewer's flapping proof: 1 notify job, not 2); `tests/jobs/alerts-db.spec.ts` lifecycle (re-open inside vs outside the cooldown) |
| L-2 (C L-2) backup-alert by name | `backup-alert.yml` `if:` requires `workflow_run.path == '.github/workflows/backup.yml'`, `head_repository.full_name == github.repository`, event in schedule/dispatch; the step re-checks path, branch and repository case-sensitively; policy rule `workflow-run-pinned` | `17634ba` | `tests/ci/workflow-policy.spec.ts` › "backup-alert.yml against a fork PR's spoofed 'Staging backup' run" (GitHub-semantics evaluator: fork/pull_request_review/other path refused at the `if:`; mixed-case branch/path/owner pass the `if:` but the step exits 1 and opens nothing; genuine runs open the issue via a recording `gh`); `bypass-workflow-run-name-only.yml` fixture |
| L-3 (C L-3) case-insensitive `==` | Every staging job starts with `[ "$GITHUB_REF" = "refs/heads/feature/v2" ] \|\| { …; exit 1; }` (9 jobs in `staging`, `drift`, `ops-report`, `backup`); rule `staging-exact-ref-step` (first step, no `if`/`shell`/`env`/`continue-on-error`) | `17634ba` | `tests/ci/workflow-policy.spec.ts` › exact-ref step (removed, conditioned, weakened → refused; `Feature/V2` passes GitHub's `==` but the step exits 1) |
| L-4 (C L-4) R-51 without end | A try that died with `alert_channel_unconfigured` sets `ops.alerts.notify_stopped_code` (terminal) and drops the dead-try link; no further retry; clearing the code resumes | `448a769` | `tests/jobs/alert-review-fixes-db.spec.ts` › L-4 (1 dead job, not one per 15 min; report shows it unsent; other codes still retried; clearing resumes) |
| Plan/roadmap drift (IND L7) | R-49 row added to the rulings; R-14/R-30/R-16 marked; key_links, artifacts, acceptance lines and an errata paragraph in `04-PLAN.md`; roadmap V2-04 dependencies, expected changes and acceptance: R2 instead of `ap-south-1` (erratum 2026-11-14); `backup.sh` header Environment `staging-backup` | `838d4bd` (`backup.sh` in `448a769`) | documentation |
| Runner secrets (triage "Accepted") | `docs/runbooks/jobs.md` §2: staging and production never share `JOBS_RUNNER_SECRET` (tokens are not bound to an environment); `staging.md` §5: never share secrets across environments; restore §8 step 5 | `838d4bd` | documentation |

## Deviations

1. **"Signed manifest" not built (triage M-BACKUPAUTH wording).** The digest is recorded in three places the R2 token
   cannot write: `ops.backup_runs`, the `backup.yml` job summary, and its `backup-evidence` artifact. The restore requires
   it. Any signing key that `backup.yml` can use would sit in the same reviewer-free Environment as the R2 token, so it
   would add nothing against the M-1 attacker. A signature with a key held outside GitHub is the reviewer's "longer
   term" item; it goes to the owner of the bucket lock (V2-15, go-live backups). **Needs the orchestrator's
   confirmation.**
2. **Environment allowlist by name, not per file.** The reviewer's "better still" suggestion was a per-file allowlist.
   The policy instead allows exactly the three Environment names. `staging-backup` stays limited to `backup.yml`
   (`staging-backup-environment-scope`, now case-insensitive), and `ops-report.yml` stays limited to
   `staging-readonly`. A new Environment needs a reviewed policy change.
3. **`backup.sh` writes the digest only when the column exists.** The code can reach the twice-daily run before the
   PO approves the staging migrate. Until then the digest still goes to the summary and the artifact.
4. **SQL guard scope.** It allows pg_dump 17.6+'s own `\restrict <key>` / `\unrestrict <key>` lines, which exist to
   disable meta-commands. It also refuses `COPY … PROGRAM` (defence in depth; the digest is the primary control).
5. **L-4 only for `alert_channel_unconfigured`, with no daily cap.** The reviewer's optional daily cap and separate
   sending domain were not in the triage. The ops report is unchanged: it already shows the alert as `unsent`.
6. **actionlint/zizmor clean.** I added `# shellcheck disable=SC2016` directives with their reasons to `ci.yml` and
   `nightly.yml` (pre-existing infos). zizmor's `dangerous-triggers` on `backup-alert.yml` is suppressed inline, with the
   pinning as the reason. Evidence: `evidence/04-07c/workflows-actionlint-zizmor.txt`.
7. **A short window of shared-stack interference.** My first negative-proof attempt replaced `ops.evaluate_alerts()`
   and dropped `backup_runs_ok_has_digest` on the local stack for a few seconds. Another plan's lane held the run lock
   at the time (pid 18670). Both changes were restored at once, and `schema-snapshot --check` passes. The proofs were
   then re-run inside rolled-back transactions under the run lock (`evidence/04-07c/migration-000042-negative-proof.txt`).
   Later, a shell chain whose lock acquisition failed still ran its `rm -f` of the lock file. That deleted the e2e
   lane's lock (Playwright, pid 48732) for about a second. I recreated it with that pid at once; no other run started
   in between. The scripts now remove the lock only when they took it.

## PO-ACTIONS text changes (for the orchestrator; `.planning/PO-ACTIONS.md` not edited here)

- **04-P13 (first staging restore drill):** both commands gain `--expect-sha256 <digest>`. The digest comes from the
  green "Staging backup" run that names the object key (job summary, "Backup archive"), or from
  `gh run download <id> -n backup-evidence` → `archive-digest.json`. Confirm that run is `backup.yml` on `feature/v2`.
- **Optional hardening (L-3, second half):** Settings → Rules → Rulesets → new branch ruleset: target branches matching
  `[Ff][Ee][Aa][Tt][Uu][Rr][Ee]/*`, exclude `feature/v2`, restrict creations. The in-repo control is the exact-ref
  step.
- **04-P8 and V2-15 go-live:** generate the production `JOBS_RUNNER_SECRET` separately and never copy the staging one;
  every rotation record confirms "staging and production runner secrets differ".
- **Staging without `OPS_ALERT_EMAIL`:** after setting it, run
  `update ops.alerts set notify_stopped_code = null where status = 'open';` (SQL editor) to resume pending
  notifications.
- **Real restore (runbook §8):** `select ops.ensure_schedules();` after the data restore, then
  `select ops.ensure_schedules(true);` after the pending-jobs review and the Vault secrets.

## For close

- `REQUIRED_FILES` gains `tests/ops/restore-guards.spec.ts`, `tests/ops/ensure-schedules-db.spec.ts`,
  `tests/jobs/alert-review-fixes-db.spec.ts`.
- `VERIFICATION_LOG` §4 should list the roadmap erratum (V2-04 staging bucket R2, 2026-11-14). This plan did not edit
  `VERIFICATION_LOG`.

## Evidence (`evidence/04-07c/`)

`workflow-policy-bypass-before-after.txt`, `restore-guards-negative-proof.txt`, `migration-000042-negative-proof.txt`,
`restore-drill-selftest.json` + `restore-drill-selftest-run.txt` (self-test after `db reset --local` with 000042:
digest ok, tampered refused, SQL guard PASS, 13 pgTAP checks), `workflows-actionlint-zizmor.txt`, `vitest-full-run.txt`,
`gitleaks.txt`. Full Vitest lane at `838d4bd` (+ docs only after): **206 files, 4294 tests passed, 0 failed**
(`vitest-full-run.txt`). Orchestrator request: `docs/runbooks/jobs.md` §11 now says a dead-lettered share message cannot
be replayed (its link was scrubbed) and is re-shared from the app (evidence commit).
