---
phase: 04
plan: 04-07d
subsystem: job queue claim fairness, restore guard, messaging (re-verification follow-ups N-1, N-2, L-A, L-C, Info)
status: complete
plan_head_before: 635cd5d
---

# 04-07d record: re-verification follow-ups

**Outcome:** every open item of `reviews/v204-review-high-reverify.md` is fixed or accepted, and each fix has a test
that fails without it (negative proofs in `evidence/04-07d/`). Local stack only: every Supabase CLI call `--local`, no
`--linked`, no `db push`, no hosted call, no `.env*` read; MSW and fakes only. The shell commands in the N-2 proofs are
harmless `echo`s inside throwaway local psql containers. Base `635cd5d`. Commits: `4db5e35` (N-1, migration 000044),
`af92fe6` (N-2), `3fc02a9` (Lows), then this docs commit.

## Triage ID → commit → test

| ID | Fix | Commit | Test (fails without the fix) |
|---|---|---|---|
| **N-1** (Medium; M-FAIR) | Migration **000044**: new `ops.jobs.last_claimed_at`, stamped by every claim (re-claims too), and index `jobs_tenant_last_claimed_at (tenant_id, last_claimed_at)`. `claim_jobs` picks the due tenants **least recently served first** (newest `last_claimed_at` over the tenant's jobs, never-served first), then by oldest due work, at most `p_batch` tenants. Round 1 of the round-robin gives every chosen tenant a row, so a tenant with due work is served within ceil(tenants with due work / batch) claims, whatever the size or age of the others' backlogs. Unchanged: one statement, `FOR UPDATE SKIP LOCKED`, per-tenant cap, round-robin within the batch, fresh lease per row, no attempt at claim, signature and grants. No cursor table, so concurrent claimers never contend on a shared row. `EXPECTED_MIGRATION = "000044"`, schema snapshot regenerated after `db reset --local` under the run lock; `npm run db:types` produced no change (`ops` is not in the generated types). | `4db5e35` | `parallel-dispatch-db.spec.ts` "tenant rotation …": (1) the re-verifier's repro (10 tenants × 40 jobs from 30 minutes ago, an 11th tenant's job from 1 minute ago, every batch marked done) → victim claimed in batch ≤ 2; on 000043 it was **batch 41**, the reviewer's exact number. (2) 23 backlogged tenants all served within 3 batches (000043: the same 10). (3) The real runner with `RUN_PASS_CONFIG` runs the victim's job among its first 20 (000043: not among the 23 it ran). `evidence/04-07d/n1-negative-proof.txt`. |
| **N-2** (Medium; M-BACKUPAUTH) | **Guard** (`ops/restore-drill/sql-guard.ts`): independent of `standard_conforming_strings`. Inside a standard string, a backslash directly before a quote, the only place the two readings part, is refused (`\\` and other escapes read the same either way). Also refused, whatever the lexer state: a line starting with a backslash outside COPY data; any statement naming `standard_conforming_strings` or `client_encoding` other than pg_dump's own `SET … = on` / `SET client_encoding = 'UTF8'` (`SET`, `SET LOCAL`, `RESET`, `set_config`, quoted spellings, function bodies); a file that is not valid UTF-8. `--emit-dir` writes restore copies in which only pg_dump's own `\restrict` / `\unrestrict` lines are comments. **Runtime:** new `ops/bin/psql-restricted.sh` is `psql-docker.sh` whose session starts with `\restrict <48 hex from /dev/urandom>`, so psql itself refuses every meta-command. `run.sh` restores only the guard's copies, only through it. **Runbook** §7 step 2, §8 step 2 and §10, plus PO-ACTIONS 04-P13: the restore digest comes **only** from the green GitHub `backup.yml` run (job summary or `archive-digest.json`), never from the bucket or `ops.backup_runs`. A real restore uses the guard's copies and `psql-restricted.sh`. | `af92fe6` | `restore-guards.spec.ts` "sql-guard.ts does not depend on standard_conforming_strings …": the re-verifier's file, the same strings without the `SET`, set_config / RESET / quoted spellings, client_encoding changes, line-start backslashes inside a string / dollar quote / comment, non-UTF-8, `--emit-dir` (16 cases; the 04-07c guard passes the repro). `restore-psql-restricted-db.spec.ts` (real psql 17.11 against the local stack): the repro is refused (exit 3, no echo); with the 04-07c call (`psql-docker.sh`, unrestricted) psql **ran the shell command** (exit 0). `evidence/04-07d/n2-negative-proof.txt`. |
| **L-A** (Low) | `smsFlowVariables` is an allow-list: exactly the template's declared keys (exact match). An SMS template with no declared set sends **no** variables. | `3fc02a9` | `msg91-contract.spec.ts` "undeclared template sends no variables": `MOBİLES`, `mobiles␠`, `schtime`, `Recipients`, `flow_id`, `unicode`, and a plain param never reach the Flow body. The old code sent all but the exact control keys. `evidence/04-07d/la-negative-proof.txt`. |
| **L-C** (Low) | `generateRescheduleToken` throws the new `RescheduleNotActionableError` only for `create_reschedule_token`'s business refusals (SQLSTATE P0001/P0002 with `not_found` / `appointment_closed` / `appointment_unassigned`). Any other error is an ordinary `Error` (with `cause`), and the inbound route rethrows it: answer 500, key `failed`, and the provider's retry sends the link. | `3fc02a9` | `inbound-retry-db.spec.ts` "reschedule: the token RPC fails transiently → 500 …; the retry sends one link and writes one note" (old route: 200 `processed`, no link). Companion: a business refusal stays 200 `processed` with one note and no link. `evidence/04-07d/lc-negative-proof.txt`. |
| Info (M-RXEVENT) | Header comment of `features/prescriptions/service.ts` now says: no use-case there queues `prescription.issued`. The app queues it at signing (`:signed`), and the public API queues its own (`:created`). | `3fc02a9` | Comment only. |
| L-B (Low) | **Accepted**, owner V2-12 (triage file): member-supplied free text inside a permitted, pre-approved template's values and buttons (256-char cap). | — | — |

## A second N-2 divergence, found and closed at runtime

The re-verifier suspected a client-encoding variant and did not test it. It is real. A `DO` block that builds
`set_config('client_' || 'encoding', 'GBK', false)` from string pieces switches psql's lexer to GBK. In GBK the bytes
`AC 5C` (the last byte of a UTF-8 `€`, then a backslash) are one character, so psql ends an `E'…'` string where the
guard (reading UTF-8) does not. The guard **passes** that file, because no text scan can see a setting that
server-side code builds. Unrestricted psql then ran `\!`: the throwaway container's `sh` started and reported a syntax
error on the rest of the line. Restricted psql refuses it. `restore-psql-restricted-db.spec.ts` asserts both facts, so
this dependence on the runtime layer stays visible: the guard passes, `psql-restricted.sh` refuses. Restricted mode
(psql 17.6+, CVE-2025-8714) is therefore the guarantee, and the guard is defense in depth that fails early with a
named line.

## Decisions and deviations

- **N-1: rotation state on `ops.jobs`, not a cursor table.** The plan allowed either. A per-tenant or global cursor row
  would serialise concurrent claimers on that row and could deadlock under `lock_timeout`. The column is written by
  the UPDATE the claim already does, and the read is one backward index probe per due tenant. No backfill: at deploy,
  every tenant counts as never served, which gives the 000043 order until the first claim. The old single-column
  index `jobs_tenant_id` is now redundant with the new composite index. It is left for a contract step (V2-14), as
  expand → contract requires.
- **N-2: the drill restores from guard-written copies.** psql refuses a second `\restrict` in restricted mode (verified:
  exit 3), so pg_dump's own lines must become comments. The guard writes the copies itself, so only lines it
  validated as whole-line restrict lines between statements change, and COPY data is never touched. The spec checks
  this line by line.
- **N-2: a valid pg_dump file can now be refused** if a standard string holds a backslash directly before a doubled
  quote (`\''`). This fails closed. The real local dump passes (self-test below).
- **L-A: an undeclared SMS template sends no variables** rather than being refused. The SQL catalogue already refuses
  undeclared templates at enqueue, so only rows queued before 000041 could reach this path, and those then send a
  variable-less Flow.

## Verification (tool output in `evidence/04-07d/`)

- Negative proofs: `n1-negative-proof.txt` (3/3 fail on 000043), `n2-negative-proof.txt` (all 04-07d N-2 cases fail
  on the 04-07c guard and the unrestricted call), `la-negative-proof.txt` (2 fail), `lc-negative-proof.txt` (1 fails).
- `restore-drill-selftest-run.txt` and `restore-drill-selftest.json`: `ops/restore-drill/run.sh --self-test` on this
  tree. A real local `supabase db dump` archive passes the guard (6 files, copies written), restores through
  `psql-restricted.sh` into the drill stack, and passes compare-manifest, the 13 pgTAP checks and `check-evidence`.
- `vitest-full.txt`: full `npx vitest run` on `3fc02a9`, **209 files, 4345 passed, 0 failed** (first run, nothing
  retried).
- `e2e-pr.txt`: `npm run e2e:build` then `npm run e2e:pr` on `3fc02a9`, **196 passed, 9 skipped, 0 failed, 0 retries**.
  The server's `ECONNRESET: aborted` lines are client-aborted requests during navigation, logged by the web server.
  They are not test results.
- Static: `npm run typecheck` 0 errors; `npx eslint .` 0 errors (382 warnings, none on lines this plan added);
  `npm run inventory` exit 0; `node scripts/drift/schema-snapshot.mjs --local --check` PASS (2519 lines).
- `gitleaks.txt`: gitleaks docker scan of the history after the 04-07d commits.

## Not changed (owner)

- `jobs_tenant_id` (single-column index) is redundant with `jobs_tenant_last_claimed_at`. Drop it in a contract
  migration (V2-14).
- psql variable interpolation (`:name`) re-lexes a variable's value. The restore sets no variable the archive
  controls, and `ON_ERROR_STOP` ends the run at the first error, so `LAST_ERROR_MESSAGE` is never used. Restricted
  mode covers it in any case. No change.
