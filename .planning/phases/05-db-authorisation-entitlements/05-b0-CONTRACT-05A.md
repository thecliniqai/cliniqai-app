---
phase: 05
plan: 05-b0
part: 05b (wave 1)
subsystem: contract of 05a's expand steps (expand → migrate → contract)
status: complete (local); merge gated by R-37 (05a merged and 05-P2 verified, or staging not live)
migrations: [000079_contract_05a]
plan_head_before: d670b62
commits: [3310845, docs commit]
code_head_after: 3310845
requirements: [P1-01 (acceptance 2 contract step), P1-40]
---

# 05-b0 record: 05a's contract steps

**Outcome:** done locally on `v2/phase-05b-membership-entitlements` (branched from the 05a gate tip `d670b62`). One
migration, `000079_contract_05a`, drops what 05a's expand steps left behind:
- the six clinical columns of `visits` and the 000053 "moved" CHECK that guarded them (R-2);
- `generate_daily_queue_token` (P1-40);
- the two legacy "any membership" helpers.

It also validates the notice `link_url` CHECK that 05a assigned here. `contract_05a.test.sql` fails 12 of 18 at
`000078` and passes 18/18 at `000079`. The full Vitest, pgTAP and e2e PR lanes are green with 0 retries. No hosted
system was contacted; every Supabase CLI call used `--local`.

## What changed

| Step (plan / assignment) | Change in 000079 | Proof |
|---|---|---|
| Plan step 1 (R-2, acceptance 2 contract) | `DROP CONSTRAINT visits_clinical_content_moved`, then `DROP COLUMN` `vitals`, `chief_complaints`, `clinical_notes`, `specialty_data`, `investigations_advised`, `advice` (IF EXISTS). Before writing the file, the drop was dry-run in a rolled-back transaction without CASCADE: no view, policy, index, trigger column list or function depends on these columns. The content lives in `clinical_notes` since 000053 | `contract_05a` 1-8; `clinical_notes` (writes into the old columns are now 42703, and the visit row is still readable and writable); `role-rls.spec.ts` (real JWT: `select *` returns no clinical key, naming a dropped column is 42703, writes are PGRST204) |
| Plan step 2 (P1-40) | `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated, service_role`, then `DROP FUNCTION public.generate_daily_queue_token(uuid, date)` | `contract_05a` 9, 12; `issue_queue_token` stays (13) |
| 05-02c wave note: "drop candidates for 05-b0" | The same revoke + drop for `current_user_has_role(uuid, text[])` and `current_user_is_admin_or_owner(uuid)`. Since 000061 they have no caller in SQL or the app (checked with `git grep` over `app lib features components scripts` and with `pg_proc.prosrc`). `current_user_tenant_ids()` stays: it is the member helper (R-42) | `contract_05a` 10-12, 14 |
| 05a triage: "`link_url` CHECK VALIDATE → 05-b0" | A NOTICE reports D11n (and D53c, visits still holding moved content). Then `VALIDATE CONSTRAINT in_app_notifications_link_url_relative`. If D11n > 0 the VALIDATE fails with 23514 and the migration stops, as 000076 does on D7i | `contract_05a` 15-18 |
| Plan step 3 | `npm run db:types`; `npm run typecheck` passes with no reference to the dropped columns or functions. The app needed no change: it reads clinical content only through `clinical_notes`, via `lib/db/clinical-notes.ts`. Only a comment changed | typecheck exit 0 |

Test files that followed the dropped objects, with their counts:
- `clinical_notes.test.sql`: the 9 CHECK cases became their post-contract equivalents. Writes are now 42703. The
  "empty values" control became "the visit row is still writable". "CHECK VALID" became "none of the six columns is
  left". The count stays 53.
- `clinical_notes_backfill.test.sql`: the 000053 replay now re-adds the six columns with their pre-000053 types and
  defaults inside its transaction. The replayed statements are still byte-identical to the migration
  (`clinical-notes-backfill-inline.spec.ts`). The count stays 9.
- `definer_functions.test.sql`: the three functions' classification rows, grantee entries and six dual-member legs are
  removed. The count goes from 40 to 34.
- `membership-guard.spec.ts`: the dropped functions are removed from the SEC-09 lists, and the anon list now names
  `issue_queue_token`.
- `role-rls.spec.ts`: the three visit-column cases assert the dropped-column errors.

## Deviations

1. **The two legacy helpers are dropped here.** The plan names only the clinical columns and
   `generate_daily_queue_token`. The 05-02c wave note named the helpers as 05-b0 drop candidates. They are dead code
   with EXECUTE for `authenticated`, and dropping them removes two definer functions from the API surface. Dropping
   them is not a behaviour change, because nothing calls them.
2. **`link_url` VALIDATE is in the same migration.** One file for every 05a contract step. A non-zero D11n stops the
   whole file, which is transactional, so nothing is half-applied.
3. **I-2 (bump `current_revision` past existing rows) is not applied.** The triage condition is "only if a v2 database
   with real users is ever migrated". No such database exists: staging is synthetic and production is new.
4. **The pgTAP gate is raised in this plan.** The plan defers this to the 05b close, but the execution rules for 05b
   say each plan adds its files and raises the floor. `REQUIRED_FILES` gains `contract_05a`, and `FLOOR` goes from
   3343 to 3355. The arithmetic: 3343 − 6 dropped definer legs + 18 new cases.

## Deploy notes (carried forward for the 05b merge and the staging migrate, 05-P2/05-P8)

- **Order (R-37):** apply 000079 only after the 05a app is serving on the target (05-P2 verified), or on a database
  with no app yet (the first staging bring-up applies every migration before the app deploys). An older build that
  reads `visits.vitals` etc. or calls `generate_daily_queue_token` breaks after 000079.
- **Diagnostics first (local tool; 05-P8 on staging):** `npm run db:diagnostics`. D11n must be 0 or 000079 stops at
  the VALIDATE. The 05a set still applies to a database migrating from before 05a:
  - **D1/D1x/D5x:** 000050 VALIDATE.
  - **D6/D6d:** 000063, 000069.
  - **D9t:** 000069.
  - **D5s:** 000069 stops.
  - **D7i:** 000076 stops.
  - **D1p, D11r, D1f:** report only.
- **000070 after the `issue_queue_token` app is serving** (an older build inserts `queue_tokens` itself); on a live
  database split the run at 000069 (05a summary).
- **Hosted Auth "Confirm email" stays ON** (05-P9). H-INVITE binds redemption to the confirmed email.

## Local evidence (tool output, `evidence/05b/05-b0/`)

| Check | Result | File |
|---|---|---|
| Diagnostics before 000079, on the populated shared stack (416 tenants, 3365 visits) | D11n 0, D7i 0, D5s 0, D1p 0, D1f 0, D11r 0, D6d 0, D9t 0. `blocking_nonzero` lists D1/D1x/D2/D4b rows: cross-tenant fixtures planted by stopped runs from another worktree (the 05a close note; 000079 validates no FK). The reset removed them | `diagnostics/05b-b0-before.json` |
| Diagnostics after 000079 (fresh reset + `seed:local`) | `blocking_nonzero` `[]`, D0 = 79 | `diagnostics/05b-b0-after.json` |
| New pgTAP file at 000078 / with 000079 | 12 of 18 fail (the 6 that pass: the content columns on `clinical_notes`, the two kept functions, the CHECK's behaviour on new rows and D11n = 0) / 18/18 | `pgtap-contract_05a-without-000079.tap`, `-with-000079.tap`, `without-000079-db-version.txt` |
| pgTAP lane + gate (db 000079) | 32 files, **3355/3355**; gate PASS (floor 3355, 32 required) | `pgtap-lane.tap`, `pgtap-report-gate.txt` |
| Full Vitest (db 000079, tree = `3310845`) | **248 files, 4876/4876 passed**, 0 failed, 0 skipped; gate PASS (floor 4633, 155 required); teardown removed 208 run tenants and verified none remain | `vitest-summary.json`, `vitest-report-gate.txt` |
| e2e PR lane (desktop, Pixel 7, iPhone 15), fresh `e2e:build` at `3310845` | **220 passed, 9 skipped, 0 failed, 0 flaky, 0 retried** | `playwright-summary.json`, `e2e-pr-tail.txt`, `e2e-build-tail.txt` |
| typecheck, `eslint . --quiet`, inventory, `db:drift:local`, `schema-snapshot --check`, `authz:gen` (no diff) | all exit 0 / PASS | commands run before the commit |

**Shared stack.** Every run took the shared test-run lock and waited for V2-06's runs where needed. The e2e run took
the e2e lane lock with an owner file. `supabase db reset --local` ran once for this plan (2026-11-14T19:51Z, under the
lock) and was followed by `npm run seed:local` (no `--reset`). Wave notes row added.

## Threats

The migration only removes surface: two definer helpers and one definer generator, all with EXECUTE for
`authenticated`. It also validates an existing CHECK. It adds no table, grant or policy. T-05-02 (receptionist read of
clinical content) can no longer be bypassed through `visits` columns, because the columns no longer exist.

## Open items

- **Merge gate (R-37):** 05b merges only after 05a has merged and 05-P2 is verified (or staging is not live).
- No other open item from 05-b0.
