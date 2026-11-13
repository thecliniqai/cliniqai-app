# V2-04 adversarial re-check of N-1b and N-2b (04-07e fixes)

- **Reviewer.** An isolated adversarial re-checker with fresh context. I read `04-07e-FAIRNESS-RESTORE-FIXES.md` only
  after reaching the verdicts.
- **Commit.** `b5c9e11` on `v2/phase-04-jobs-reliability`. Local stack at migration 000045. I did not reset it.
- **Method.**
  - Code reading.
  - One temporary Vitest probe, `tests/jobs/zz-n1b-recheck-probe.spec.ts`. Only that file ran. It used the real
    `runJobs`, `RUN_PASS_CONFIG` and `claim_jobs`, and I deleted it afterwards.
  - Pinned psql 17.11 (`ops/bin/psql-docker.sh` / `psql-restricted.sh`) against a scratch database and a scratch role,
    both dropped afterwards.
  - `manifest-guard.ts` and `sql-guard.ts` CLIs on crafted inputs.
  - Every shell payload was a harmless `echo`.
- **Housekeeping.** After the run:
  - 1 tenant (the seed) and 0 `test.%` jobs remain.
  - There are 0 probe runner rows.
  - The `probe_n2b` database and the `probe_n2b_r` role are dropped, and no login event trigger is left.
  - `git status` is unchanged.
  - The Vitest teardown reported 0 leftovers.

## Verdicts

| ID | Verdict | Summary |
|---|---|---|
| **N-1b** | **CLOSED** | The victim was served within the expected bound in every variant (pass 2 to pass 11). It is never starved. Exactly-once held with 6 concurrent runners. A hand-back restores the stamp, including after an unstarted lease expiry. |
| **N-2b** | **CLOSED** | Every psql call in the backup, restore and drill paths goes through `psql-restricted.sh`. The manifest guard refused all 26 injection variants. Settings flipped by `ALTER DATABASE`, `ALTER ROLE`, a login event trigger, or a mid-session `set_config` did not lead to execution: the wrapper's `SET` puts them back on, and restricted mode refuses every meta-command. |

## N-1b: attempts

All runs used real `runJobs` passes with `RUN_PASS_CONFIG`, a 12 s handler bound and a simulated pass clock. Each pass
is a fresh runner, as the route runs them.

| # | Attempt | Result |
|---|---|---|
| P1 | The reviewer's probe #8 exactly: 10 tenants × 40 jobs (30 min old), a fresh victim (1 min old), 1.5 s per job | Pass 1: 8 jobs ran and 2 were handed back. **The victim ran in pass 2** (before: never in 30 passes). Why not pass 1: all 11 tenants are "never served", so the tie goes to the oldest work and the victim is outside the first 10 tenants. The two handed-back tenants keep `NULL` and the victim enters pass 2. |
| P2 | 30 tenants × 15 jobs. Every tenant has served history; the victim was served **most recently**. 1.5 s per job | **Victim ran in pass 4** = ceil(31/8). Each pass ran 8 jobs and handed back 2. |
| P3 | Mixed durations: 15% of jobs take 11 s, the rest 0.2–3 s (seeded). 20 tenants × 20; victim served most recently | **Victim ran in pass 4.** 5–7 jobs ran per pass and 3–5 were handed back. |
| P4 | 12 s per job, so one job per pass and 9 handed back each pass. 10 tenants × 5; victim served most recently | **Victim ran in pass 11**, exactly its turn. The rotation advances one tenant per pass, and hand-backs never cost a turn. |
| P5 | Deferrals: 10 of 20 backlog tenants defer every job (started, so it counts as service). Victim served most recently, single job | **Victim ran in pass 3.** |
| P6 | **6 concurrent runners × 8 rounds** of passes. 20 tenants × 20 + victim (most recent); 1.5 s per job | 320 handler runs, **0 duplicates**. Every job that ran is `done` with attempts 1, and the 81 not yet reached are `pending` with attempts 0. No other state. Victim ran in round 3. |
| P7 | Claim, force the lease to expire unstarted, re-claim, then release with both lease tokens | The old token was refused (`false`). The current token was accepted. The stamp went back to `NULL`, the value from before the first claim, with status `pending` and attempts 0. |

I also read the code:

- **`claim_jobs`** (`000045:57-185`) keeps its claim behaviour:
  - one statement;
  - `FOR UPDATE SKIP LOCKED` with the due condition re-checked under the lock;
  - `prev_last_claimed_at` uses old-row values (`:162-165`).
- **`release_job`** (`:205-214`) and **`defer_job`** for an unstarted job (`:258`) restore the previous stamp.
- **`fairOrder`** (`lib/jobs/internal/claim.ts`) sorts by `claim_order` only when every row has one.
- **Runner hand-backs.** The runner's skip-and-release (`runner.ts:293-307`) now hands back the tail of the claim
  order, which holds the most recently served tenants.

I found no new N-1 issue.

## N-2b: attempts

### psql call sites (grep of `ops/`, `scripts/`, `.github/workflows/`)

- **`drill-lib.sh:20` (`drill_psql`).** This is the restore, the history restore, the migrations count, the counts, the
  objects list and the checks. It runs `psql-restricted.sh` with `-X -q -v ON_ERROR_STOP=1`.
- **`run.sh:197`.** `restore_psql` = `drill_psql`.
- **`run.sh:359,376,389,397`.** The self-test calls `psql-restricted.sh` directly. The only interpolated values are
  `$before_id` / `$last_id`, which are checked against `^[0-9]+$` first.
- **`backup.sh:169` (`psql_db`).** It runs `psql-restricted.sh` for every call (`:225,254,256,267,280,303,422`).
- **`backup.sh:dump`.** This runs `supabase db dump` (pg_dump inside the CLI's container) against the source database.
  No archive input reaches it.
- **Nowhere else in these paths.**
  - `psql-docker.sh` is called only by the wrapper. Other mentions are comments, and two specs call it on purpose.
  - The `scripts/staging/*` and `scripts/drift/*` psql uses are read-only drift tooling. They are not in the
    backup or restore path.
  - No workflow calls psql in the restore path.
  - `write_evidence` interpolates only `compare.json.ok`, a boolean that our own code writes.

### Manifest injection (`manifest-guard.ts`, 31 files: 26 injection variants, 3 shapes the guard should accept, an over-long key and a BOM)

| Variant | Result |
|---|---|
| `policies: "1 \! echo …"`, `"1;\n\\! echo"`, `"10"` (string), 1.5, -1, 1e10, `true`, `[1]`; a duplicate `policies` key whose last value is a string | REFUSED |
| Table keys: `'` / `;` / `--`, `\'` + `\!`, embedded newline, trailing `\n`, Cyrillic homoglyph, full-width letter, upper case, 64-character name, `__proto__`, `pg_catalog.pg_authid`, string count | REFUSED |
| Extra top-level field; `environment`, `server_version` or timestamp holding a newline or backslash; bucket `../x`; object names with `\` or `..` | REFUSED |
| UTF-8 BOM before the JSON | Unreadable (exit 2): fails closed |
| `public.does_not_exist`, a 63-character name, `functions: 1e3` (= 1000) | PASS, as intended. counts.sql matches only catalog tables, so a missing table is reported by compare-manifest. |

### Restricted wrapper against flipped settings

Setup:

- A scratch database `probe_n2b` with `ALTER DATABASE SET standard_conforming_strings = off` and
  `client_encoding = 'SJIS'`.
- A **login event trigger** that `set_config`s both settings at connect. `postgres` could create it on the local stack.
- A function `flip2()` that flips both settings in the middle of a session.
- A scratch role with `ALTER ROLE … SET` of the same two settings.

| # | Probe | Plain `psql-docker.sh` (control) | `psql-restricted.sh` |
|---|---|---|---|
| 1 | `show` both settings (database and login-trigger flip) | `off`, `SJIS` | `on`, `UTF8` |
| 2 | Same with the `ALTER ROLE` role | `off`, `SJIS` | `on`, `UTF8` |
| 3 | `-v expected_policies='1 \! echo …'`, used raw (`:expected_policies`) | **echo ran** | `backslash commands are restricted`, exit 3, no echo |
| 4 | Same value with an embedded newline | — | Refused, exit 3, no echo |
| 5 | Same value used quoted (`:'expected_policies'`) | — | Sent as `E'1 \\! echo …'::int`: a cast error only, exit 3 |
| 6 | Mid-session flip: `select flip2();` followed by `select 'a\'; select ' \! echo … #';` | **echo ran** | Setting reads `off` after the flip, but the meta-command is refused (exit 3, no echo) |
| 7 | Repo `counts.sql` with a guard-bypassing `tables` value (`["public.t","x\\'; \\! echo … #.t"]`) | — | Output `public.t\|1` only: the bad key never matched, no echo |

`sql-guard.ts` on the Low variants:

- **Refused:**
  - `1$a$`, `0x1$a$` and `1e5$a$` dollar quotes (L-D);
  - `U&"…"` (L-E);
  - `ALTER ROLE` / `ALTER DATABASE … SET` of either setting;
  - `set_config(…)` at top level;
  - `SET NAMES`;
  - a function-level `SET standard_conforming_strings`;
  - `COPY(` / `COPY/**/ … PROGRAM` (L-F).
- **Passed:** these three spell the change dynamically, beyond the guard's documented lexical scope:
  - a `DO … EXECUTE format('ALTER ROLE … SET %I', …)` block;
  - `UPDATE pg_settings SET setting = …`;
  - `CREATE EVENT TRIGGER … ON login`.

  Probes 1, 2 and 6 show they cannot be turned into execution. The guard is defense in depth, and the restricted
  session is the barrier.

## New findings

| ID | Severity | Where | Finding |
|---|---|---|---|
| I-1 | Info | `.planning/phases/04-jobs-reliability/04-07e-FAIRNESS-RESTORE-FIXES.md:43-44` | The record says "A login event trigger could flip the setting at connect, but creating one needs superuser." On the local stack, `postgres` (`rolsuper = f`) created `CREATE EVENT TRIGGER … ON login` and `ENABLE ALWAYS` without error. This is presumably supautils' event-trigger delegation, which Supabase also ships hosted. There is no security impact: the wrapper's `SET` runs after the login trigger and won (probe 1), and restricted mode would refuse a meta-command anyway. Correct the sentence. Optionally, `sql-guard` could refuse `CREATE EVENT TRIGGER … ON login`, since pg_dump of this schema emits none. |

No other new findings.
