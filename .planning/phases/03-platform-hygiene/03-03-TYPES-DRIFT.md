# 03-03 record: generated types, migration immutability, drift baseline (P1-34 B1/B2/B4, RL-13b, R-3, R-4)

**Outcome:** done locally. The hosted half of B1 (the drift report against the v1 hosted project) is **pending PO
(E1a)**: the tool is built and tested, and it runs only on a dump file the PO provides.
**Evidence:** `evidence/03-03/` (checks and negative proofs) and `evidence/b1/` (drift reports). Every number below
comes from those tool outputs; `evidence/03-03/commit.txt` holds the SHA the checks ran on.

## Commits

| SHA | Subject |
|---|---|
| `a01ffd4` | feat: generated `Database` types; tests typed as `SupabaseClient<Database>` (B4, RL-13b) |
| `116c448` | feat: migration immutability gate (B2, R-4) |
| `bffa0c3` | feat: local drift gate and hosted-dump drift tool (B1) |
| `9d5e644` | ci: immutability in `static`; types freshness and local drift in `test` |
| `b8f3819` | fix: lockfile valid for `npm ci` on Linux (emnapi optional entries) |
| `c447ae7` | ci: `scripts/ci/lock-linux-check.sh` |
| (next) | docs: this record and the evidence |

## Generated types (B4, R-3, RL-13b)

- `supabase` CLI pinned to exactly `2.120.0` (was `^2.15.8`, which resolved to 2.120.0).
- `npm run db:types` = `supabase gen types typescript --local --schema public > types/database.ts`, then
  `prettier --write` on that file (the CLI prints unformatted output and suggests `oxfmt`, which is not a dependency;
  prettier already is). Output is deterministic: two runs on the same schema give identical files.
- `lib/db/types.ts`: the hand-written `Database` interface (990 lines) is replaced by
  `export type { Database } from "@/types/database"`; the domain interfaces stay (R-3).
- App code: `tsc -p tsconfig.json` exit 0 with the generated type (no app change needed).
- Tests: with `TestDb = SupabaseClient<Database>` and the old test code, `tsc -p tsconfig.tests.json` reports
  **32 errors** in 11 files (`evidence/03-03/typecheck-without-test-fixes.txt`, reproduced in a throwaway worktree;
  matches research). Fixed without `@ts-ignore`/`@ts-expect-error`:
  - five copies of an untyped `insertRow(table: string, row: Record<string, unknown>)` → one typed builder
    `insertReturningId<T extends IdTable>(db, table, row: TablesInsert<T>)` in `tests/helpers/db.ts` (a seed that
    names a missing column or omits a required one no longer compiles), plus `rowById` and `rowsWhereIn`;
    supabase-js cannot resolve `from()` for a type parameter, so these read the builder through one narrow,
    commented interface view;
  - jsonb `metadata` reads go through `jsonObject()` instead of inline casts;
  - a `.single()` result gets a null check;
  - `auditLogId` in the cross-tenant ecosystem is `number` (`audit_logs.id` is `bigint`); it was typed `string`.
- `TestDb` stays as the exported name for `SupabaseClient<Database>` (six helper modules import it); the loose
  `SupabaseClient<any, "public", any>` seam is gone.
- Vitest coverage exclude names `types/database.ts`; the comment that called `lib/db/types.ts` generated is fixed.

## Migration immutability (B2, R-4)

`scripts/ci/migration-immutability.mjs --base <ref>` compares `supabase/migrations` with the merge base of `<ref>`,
including the working tree (uncommitted edits and untracked files), so it also works as a local pre-push check.
Fails on: any status other than `A` for an applied file (named with its status); a new file not named
`NNNNNN_snake_case.sql`, which also catches the CLI's timestamped `db diff -f` output; a new number not above the
base's highest; two files sharing a number. Exit 2 if the base cannot be resolved (shallow clone).
Real repo: PASS against `origin/feature/v2` (24 applied unchanged); appending one line to `000007` → exit 1 naming
it; restored → PASS (`evidence/03-03/migration-immutability.txt`).

## Drift (B1)

**Local half (CI `test`):** `scripts/ci/local-drift.mjs` runs `supabase db diff --local --agent no --output-format
json` and prints to stdout only (never `-f`). The CLI switches to JSON output when it detects an agent, so the format
is pinned explicitly to keep local and CI parsing identical. Result on the migrated stack: 1 statement, the
allowlisted `drop extension if exists "pg_net";` (CLI shadow-DB false positive), 0 drift (`evidence/b1/local-drift.*`).

**Negative proof** (`evidence/03-03/types-and-drift-negative.txt`, run with the test-run lock held): adding a column
to `public.patients` directly in the local DB makes `npm run db:types && git diff --exit-code -- types/database.ts`
exit 1 (the diff shows the new field) and `local-drift.mjs` exit 1 (printing the `alter table` statement); dropping
the column again restores exit 0 for both.

**Hosted half (tool ready; report pending PO E1a):** `scripts/drift/hosted-dump-diff.mjs <dump.sql>`
1. refuses unless the stack DB URL is loopback, before any connection (exit 2);
2. creates `drift_scratch_<pid>_<ms>` in the local Postgres container (`docker exec … psql`);
3. gives it the Supabase base the dump assumes: the local `auth` schema (schema-only, no owners, no grants) and the
   schemas named by the dump's `CREATE EXTENSION … WITH SCHEMA` lines (the dump references `auth.users` in foreign
   keys and `auth.uid()` in policies);
4. loads the dump with `ALTER … OWNER TO` lines stripped, `ON_ERROR_STOP`;
5. runs `supabase db diff --db-url <scratch> --schema public`. Verified on CLI 2.120.0 that this builds a shadow
   database from `supabase/migrations` ("Creating shadow database…", every migration applied), so the second migra
   scratch database in the plan's fallback was not needed;
6. writes `<label>-drift.txt` and `<label>-drift.json` (statement counts, the dump's sha256, no dump content) and
   always drops the scratch database.
Proof with a schema-only dump of the **local** database (`supabase db dump --local`): 0 drift statements
(`evidence/b1/local-dump-roundtrip-drift.*`); the same dump plus one added column → exit 1 naming
`"drift_probe_note"`; non-loopback stack URL → exit 2, no report; no `drift_scratch_*` database left
(`tests/ci/hosted-dump-diff.spec.ts`).

**For the PO (E1a), outside any agent session:** `supabase db dump --db-url "<hosted URL>" -f <path outside the
repo>/hosted-schema.sql` (schema only is the default; no data). Hand over the path; the agent then runs
`node scripts/drift/hosted-dump-diff.mjs <path>/hosted-schema.sql` (default output `evidence/b1/hosted-drift.*`).
Any drift is documented, not reconciled (production is built from migrations, C26). Then E1b (pause) and E1c (unlink).

## CI

- `static`: checkout `fetch-depth: 0`; `migration-immutability.mjs --base "origin/<PR base or feature/v2>"` (base
  passed through `env`, not interpolated into the script).
- `test`, after the stack starts: `npm run db:types && git diff --exit-code -- types/database.ts`, then
  `node scripts/ci/local-drift.mjs`. The hosted-dump spec runs in the normal Vitest lane (it needs Docker and the
  stack, both present in `test`).

## Checks (on the SHA in `evidence/03-03/commit.txt`)

| Check | Result | Evidence |
|---|---|---|
| `npm run typecheck` | exit 0 | `typecheck.txt` |
| `npx eslint .` | 0 errors, 435 warnings (same as the 03-06 baseline) | `eslint-summary.json` |
| `npm run inventory` | exit 0 | `inventory.txt` |
| New specs (`tests/ci/{migration-immutability,local-drift,hosted-dump-diff}.spec.ts`) | 21 tests pass | `vitest.json` |
| Full Vitest lane (`npm run test:db`) | 108 files, 1948 tests, 1948 passed, 0 failed, 0 skipped; report gate PASS (floor 1805) | `vitest.json`, `vitest-report-gate.txt` |

## Lockfile note (orchestrator request; PR #5 CI failure at `3f72aa5`)

All five jobs failed at `npm ci`: "Missing: @emnapi/runtime@1.11.3 / @emnapi/core@1.11.3 from lock file". The lock was
written by npm 11.6.2 on macOS; CI's Node 24 npm 11.19.1 on Linux requires the optional `@emnapi` entries under
`@tailwindcss/oxide-wasm32-wasi`. `b8f3819` regenerates the lock in `node:24` (`npm install --package-lock-only
--ignore-scripts`); the diff adds those entries and drops stale `"peer": true` flags only. Proof:
`evidence/03-03/lock-linux-before.txt` (old lock, exit 1, the two "Missing" lines) and `lock-linux-after.txt`
(exit 0); `npm ci --dry-run` on macOS still exits 0.
**Guard:** after any local `package.json`/lock change, run `scripts/ci/lock-linux-check.sh` (check mode, read-only
mounts) or `scripts/ci/lock-linux-check.sh --fix` (rewrite with Linux npm, then check) and commit the lock diff on its
own. Not wired into CI: CI's own `npm ci` is the check there. Later owners of `package.json` in this phase (03-10,
03-11a, 03-05, 03-11b, 03-12c) should run it before committing.

## Deviations from the plan

1. **Grants kept in the hosted load** (plan: "ownership/ACL statements stripped"). Measured: with grants stripped,
   migra reports every table privilege as drift (one `revoke` per privilege, role and table), hiding real drift. Grants load because
   the Supabase roles are cluster-wide in the local container, and a hosted grant the migrations do not make is
   security-relevant drift. A grant to a role that does not exist locally fails the load with psql's error (exit 2),
   to be resolved when the real dump arrives.
2. **Local `auth` schema as the scratch base** (not in the plan): required for the dump to load.
3. **No second migra scratch DB:** not needed (CLI behaviour verified, step 4 of the plan allowed either).
4. **Local dump round trip prints 0 statements, not "only the allowlisted line":** with `--schema public` the
   extension-level pg_net line is out of scope. The allowlist is still applied.
5. **`db:types` formats with prettier** (existing devDependency), so later migration plans get readable type diffs.
6. **Immutability checks the working tree too** and enforces the `NNNNNN_` name; in a clean CI checkout this equals
   `<base>...HEAD`.
7. One read-only `git fetch origin feature/v2` to have the base ref locally for the real-repo proof.
8. Lockfile fix and `lock-linux-check.sh` added at the orchestrator's request (above).
