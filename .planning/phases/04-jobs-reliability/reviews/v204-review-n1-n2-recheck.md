# V2-04 adversarial re-check of N-1 and N-2 (04-07d fixes)

- Reviewer: isolated adversarial re-checker, fresh context. I read `04-07d-REVERIFY-FIXES.md` only after reaching
  the verdicts, to see whether the new findings were already known. They were not.
- Commit: `3947174` on `v2/phase-04-jobs-reliability`. Local stack with migrations up to 000044.
- Method:
  - Code reading.
  - One scratch Vitest probe, kept outside the repo. It uses the real `runJobs`, `RUN_PASS_CONFIG` and `claim_jobs`.
  - psql 17.11 from the pinned image (`ops/bin/psql-docker.sh` / `psql-restricted.sh`) against the local stack.
    Every shell command was a harmless `echo`.
  - SQL setting probes in rolled-back transactions.
- Housekeeping:
  - My first probe config accidentally ran the whole Vitest suite. My probe's 4 tests failed and the suite's
    teardown failed with "URI too long".
  - I removed the leftovers by hand: 60 probe tenants, then the suite's own `teardownRun` for that window (168
    tenants, 322 users, 1397 objects), then 2 `dead_letter`/`lease_expiry` alerts and their notify jobs, which cron
    had raised from those leftovers.
  - Final state: 1 tenant and 5 auth users (the seed, as before), all 9 cron jobs active. One open `backup_stale`
    alert and its notify job remain. It is a cron result on the seed's backup rows, not probe data.
  - The accidental full run also passed the repo's own N-1 and N-2 specs (4345 passed; the only failures were my 4
    probe tests).

## Verdicts

| ID | Verdict | Summary |
|---|---|---|
| **N-1** | **OPEN** | The SQL rotation works. But a job that was claimed and **handed back unstarted** also counts as service. Through the real runner, with the route's configuration and message.send's bound, the original victim is starved again (**N-1b**, Medium). |
| **N-2** | **OPEN (reported vector CLOSED)** | Restricted mode stops every meta-command in the restore session. The sql-guard is bypassable again (Low). Separately, the drill still passes **archive-controlled text to an unrestricted psql**, and psql ran a shell command from it (**N-2b**, Medium). |

## N-1: attempts

| # | Attempt | Result |
|---|---|---|
| 1 | Original repro, SQL level: 10 tenants × 40 jobs (30 min old) + victim (1 min old), each batch marked done | Victim claimed within 2 batches. The repo spec passed in the full run. |
| 2 | 50 backlogged tenants × 12 jobs. Every tenant served once first; then a victim with `last_claimed_at = now()` (looks just served) | Victim claimed at claim 6 = ceil(51/10). Every batch had 10 distinct tenants. |
| 3 | 20 tenants with only future-due jobs + victim | 1 row claimed, the victim's. Future-only tenants take no slots. |
| 4 | Per-tenant cap: 2 tenants × 30 jobs | 5 + 5 |
| 5 | 8 concurrent claimers, 30 tenants × 20 jobs | 600 claimed, 600 distinct. Exactly once. |
| 6 | Tenant with older jobs that fail and retry forever + 15 backlogged tenants + victim | Victim claimed at claim 2. |
| 7 | Ties in `last_claimed_at` (same `now()` within one claim) | Ordered by oldest work, then tenant id. Deterministic; bound held in #2. |
| **8** | **Real `runJobs` with `RUN_PASS_CONFIG` and the 12 s handler bound (message.send's). Each job takes 1.5 s of the pass clock, so about 8 jobs fit in a pass. 10 tenants × 40 jobs (30 min old) + victim (1 min old). 30 passes.** | **The victim never ran.** 240 backlog jobs ran and 60 claims were handed back. The victim's row is `pending` with `last_claimed_at` set: it was claimed and handed back every time. |
| 9 | Same as #8 at 1.0 s per job (about 11 jobs per pass) | Victim ran in pass 20, after 252 backlog jobs. That is close to global FIFO (400 total). |
| 10 | Controls: 30 tenants at 0.5 s per job; 10 tenants at 0.5 s per job | Victim ran in pass 1 / pass 0. |

### N-1b (Medium): a hand-back counts as service, and the runner always hands back the tenant with the newest work

- **Stamping.** `claim_jobs` stamps `last_claimed_at = now()` at claim
  (`supabase/migrations/000044_claim_tenant_rotation.sql:142`).
- **Hand-back keeps the stamp.** `release_job` hands a job back unstarted but leaves the stamp in place
  (`supabase/migrations/000043_runner_review_fixes.sql:267-274`). The tenant therefore moves to the back of the rotation
  (`000044:102`) without having run anything.
- **Order inside a batch.** The runner does not run a batch in the SQL order. `fairOrder`
  (`lib/jobs/internal/claim.ts:88-111`) re-sorts the batch by each tenant's oldest `run_at`. A tenant whose work is newest
  is therefore always last in its batch.
- **Which tenant loses.** When the budget runs out mid-batch, that last tenant is skipped and handed back
  (`lib/jobs/internal/runner.ts:293`, `:307`).
- **The loop.** The next time that tenant reaches the front of the rotation, the same thing happens again.
- **When it bites.** A batch of 10 does not fit in a pass. With message.send's cost of 13.5 s, a send can only start
  in the first 11.5 s of the 25 s budget. Any average provider latency above about 1.15 s (common for WhatsApp/SMS
  APIs under load) is enough.
- **Impact.** The same impact as N-1/M-FAIR: one clinic's message is delayed until the other clinics' backlogs drain.
  TARGET §8 is not met.
- **Why the specs miss it.** The repo's runner spec uses a 1 s handler bound and so never hands anything back.
- **Fix (any one of these, ideally the first two):**
  - Stamp the tenant's service at `start_job`, not at claim. Or have `release_job` restore the previous value; the
    claim would need to keep it, e.g. `prev_last_claimed_at`.
  - Make `fairOrder` keep the SQL round-robin order, which puts the least recently served first. For example, return
    `turn` and the tenant rank from `claim_jobs` and sort by them.
  - Claim only what fits: batch ≤ floor(remaining budget / cost).
- **Regression test.** Probe #8 (real runner, 12 s bound, 1.5 s per job, 30 passes; the victim must run within
  ceil(11/8) + 1 passes).

## N-2: attempts

The restore session refused every meta-command. These checks used real psql 17.11 from the pinned image.

| # | Attempt | Guard | Plain psql (`psql-docker.sh`) | Restore psql (`psql-restricted.sh`, `--single-transaction`) |
|---|---|---|---|---|
| 1 | Original file (`SET standard_conforming_strings = off; select 'a\'; select ' \! echo … # ';`) | REFUSED (2 findings) | **echo ran** | `backslash commands are restricted`, exit 3, no echo |
| 2 | `\o`, `\set`, `\i`, `\copy … from program`, mid-line `\!` after several statements, leading spaces/tab, NBSP, BOM, CRLF line start, CRLF after a COPY terminator, `\restrict` mid-statement, `COPY … FROM stdin; \! …` on the same line, `\` inside a quoted identifier | all REFUSED | — | — |
| 3 | `COPY t FROM PROGRAM …` | REFUSED | — | — |
| 4 | **`select 1$a$'$a$ \! echo DOLLAR_BYPASS_EXECUTED #';`** (dollar quote right after a digit: psql opens a dollar quote, the guard does not) | **PASS** | **echo ran** | refused, no echo |
| 5 | **`SET U&"standard\005fconforming_strings" = off;`**, `ALTER ROLE postgres SET U&"standard\005f…" = off`, `SET U&"client\005fencoding" = 'SJIS'`, `set_config('client_' \|\| 'encoding', …)`, `DO … EXECUTE format('ALTER ROLE postgres SET %I = off', 'standard_' \|\| 'conforming_strings')` | **PASS** | — | — (SQL, not a meta-command; `ALTER ROLE postgres SET …` is allowed for `postgres` on the local stack; checked in a rolled-back txn) |
| 6 | `COPY(SELECT 1) TO PROGRAM …`, `COPY/**/t FROM PROGRAM …`, dynamic `EXECUTE 'COPY … PROGRAM …'` | **PASS** | — | — (server-side, so restricted mode does not apply) |
| 7 | Nested comments `/* /* */ \! … */` | PASS | no echo (same lexing) | no echo |
| 8 | Restricted mode on every psql call that runs the archive's SQL | — | — | Yes: `run.sh:193-198` use only `restore_psql`. **But see N-2b**: `drill_psql` (unrestricted) runs text derived from the archive. |

### N-2b (Medium): the drill passes archive-controlled `manifest.json` values to an unrestricted psql, and psql runs a shell command from them

- **Where.** `ops/restore-drill/run.sh:226-229` passes `-v expected_policies/functions/users="$(json_get "$plain/manifest.json" …)"`
  to `drill_psql`, which is plain `psql-docker.sh` (`run.sh:184`).
- **How it is used.** `supabase/tests/restore_drill_checks.sql:35,44,47` interpolates the values raw (`:expected_policies::int`).
- **Why that runs commands.** psql re-lexes an interpolated variable, so a backslash in its value starts a meta-command.
- **Not validated.** `json_get` returns `String(v)` with no type check. `compare-manifest.ts` does not check these
  three fields.
- **Proof** (local, harmless):

  ```
  psql-docker.sh -X -At -v ON_ERROR_STOP=1 -v VERBOSITY=terse \
    -v expected_policies='1 \! echo VAR_INTERP_EXECUTED #' -f var.sql   # var.sql: select :expected_policies::int;
  ```

  This printed `VAR_INTERP_EXECUTED` (exit 0). A value with a newline (`"1;\n\\! echo …"`) also executed.
- **Second route to the same sink.** `run.sh:204-216` builds `counts.sql` from the manifest's table names, using
  `'…'` literals with `''` doubling. It runs through `drill_psql`.
  - With `standard_conforming_strings` on (the default), it is safe.
  - The archive's schema can switch it off for later sessions: `ALTER ROLE postgres SET U&"standard\005fconforming_strings" = off`
    passes the guard (#5) and is plain SQL, so restricted mode does not stop it.
  - A table key such as `x\'; \! echo … #.t` then closes the literal early in psql. Proof: the generated
    `counts.sql`, run with the setting off, printed `COUNTS_SQL_EXECUTED`.
- **Impact.** Identical to N-2: a forged archive whose digest is accepted gets shell execution in the psql
  container. The container has `$WORK` mounted, which holds the decrypted plaintext, and has network access. This
  affects the drill (the PO's machine with the staging archive, and nightly CI). The §8 manual restore does not
  interpolate the manifest.
- **Fix:**
  - Validate the manifest strictly before any use: integer fields as `^\d{1,9}$`, table keys as
    `^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$`.
  - Pass the counts with `:'var'` (quoted interpolation, which is not re-lexed) or psql `\bind`.
  - Run every `drill_psql` after the restore through `psql-restricted.sh` too, since none of them needs a
    meta-command. `-o` is a command-line option, not `\o`.
  - Set `PGOPTIONS='-c standard_conforming_strings=on -c client_encoding=UTF8'` for those sessions.

### Lows (guard defense in depth; restricted mode holds)

- **L-D (Low) Dollar quotes after a digit.** `ops/restore-drill/sql-guard.ts:231` does not start a dollar quote when
  the previous character is a digit, but psql does (`1$a$…`). The guard passes a file with a live `\!` (#4).
  - This contradicts the header's guarantee at `:6-7`.
  - Fix: treat only letters, `_` and `$` as identifier characters before `$`, or refuse `$` right after a digit.
- **L-E (Low) Setting names.** The check at `sql-guard.ts:85-90` matches only the literal setting names, so `U&"…\005f…"`
  identifiers and concatenated names pass (#5).
  - The fixers' record says "quoted spellings" are refused. The `U&` spelling is not.
  - This is the enabler for N-2b's second route.
  - Fix: normalise `U&` identifiers, or refuse `U&"` and any `ALTER ROLE|DATABASE … SET` outright (pg_dump emits
    neither for these settings).
- **L-F (Low) `COPY … PROGRAM` spellings.** `isCopyProgram` (`sql-guard.ts:73-75`) needs whitespace after `COPY`, so
  `COPY(…) TO PROGRAM` and `COPY/**/t FROM PROGRAM` pass (#6).
  - It is server-side and needs `pg_execute_server_program` or superuser. The archive already runs arbitrary SQL as
    `postgres`, so the risk is low.
  - Fix: match `\bcopy\b` on the comment-stripped statement with comments replaced by a space.
