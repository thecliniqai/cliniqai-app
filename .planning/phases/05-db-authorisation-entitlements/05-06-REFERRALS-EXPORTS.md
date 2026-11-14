---
phase: 05
plan: 05-06
subsystem: referrals directory + consent; DPDP exports (exports:create on both paths, minimal DTOs)
status: complete
requirements: [P1-10, P1-11, ARC-07/C15, API-15, R-35, R-42, ruling 01-09]
plan_head_before: 70357a3
commits: [2cd19f5, b6a527c, a3ec57b, 1dd9640, 6c7c70c, docs commit]
note: 05-08 (wave 8) ran in parallel in the same tree; its commits e924df3, 8eb1ad3, b500f23, caf7779, 4d6542b sit between 1dd9640 and 6c7c70c
---

# 05-06 record: referral directory and consent; exports with `exports:create` and minimal DTOs

**Outcome:** done locally. A referral can only name an opted-in clinic (never itself) and a history snapshot needs
the patient's consent, for every writer; clinicians search the directory through a definer function that returns
id and name only. The DPDP export is built only from per-entity allow-lists, and the `/api/v1` key path needs an
`exports:create` scope that only an `exports:create` holder can grant. Nothing hosted was contacted; every Supabase
CLI call used `--local`; resets ran under the test-run lock, never while 05-08 held it.

## What shipped

| Commit | Content |
|---|---|
| `2cd19f5` (feat) | migration `000062_referrals_directory_consent`; `EXPECTED_MIGRATION = "000062"`; schema snapshot; `types/database.ts`; `RPC_REASON_CODES` += `REFERRAL_TARGET_NOT_LISTED`, `REFERRAL_CONSENT_REQUIRED`; `Tenant.referral_directory_listed`; matrix generator + domain/definer pgTAP fixtures list clinic B (the in-network target); definer catalogue rows + dual-member legs for `referral_directory_search` (committed early so 05-08 could number 000063+) |
| `b6a527c` (docs) | wave note: 000062 live, fixtures must list referral targets |
| `a3ec57b` (feat) | `features/dpdp/export-dto.ts` (allow-lists: columns selected and copied); `features/dpdp/export.ts` (API-key scope check, `ExportScopeMissingError`); v1 export route (403 for the scope, fixed error texts, no raw DB message); OpenAPI 403; `createReferral` maps the trigger reasons to fixed texts and writes the DPDP consent record only after the referral exists; v1 referral route → 422; `docs/runbooks/referral-directory.md` |
| `1dd9640` (test) | `referrals_rules.test.sql` (40), `tests/dpdp/export-dto.spec.ts` (7), `tests/api/export-scope.spec.ts` (6), `tests/helpers/referral-directory.ts`; referral specs list their targets; guard world's inbound referral from an unrelated clinic S |
| `6c7c70c` (feat) | migration `000067_api_key_scope_guard` (after 05-08's 000063-000066); `EXPECTED_MIGRATION = "000067"`; snapshot; 8 more `referrals_rules` cases (48); fixture key prefixes no longer key-shaped; `.gitleaksignore` exact fingerprint for `1dd9640` |
| docs | this record, wave notes, evidence |

### Migrations

| File | What |
|---|---|
| `000062_referrals_directory_consent` | `tenants.referral_directory_listed boolean not null default false` (set by `clinic:manage` through `tenants_update`); `private.referrals_directory_consent_guard` (SECURITY DEFINER, no API grant; BEFORE INSERT OR UPDATE OF target_tenant_id, tenant_id, consented_history_snapshot, patient_consents_history_sharing): non-null target must be listed and differ from `tenant_id` → else P0001 `REFERRAL_TARGET_NOT_LISTED` (on UPDATE only when the target/clinic changes); non-null, non-JSON-null snapshot needs consent → else P0001 `REFERRAL_CONSENT_REQUIRED`; `public.referral_directory_search(text) returns table(id uuid, name text)` (SECURITY DEFINER, EXECUTE authenticated only; `consultations:edit` in the active clinic via `authz.tenant_ids_with`, else 42501; listed clinics, never the caller's own; ≤ 20 rows; queries < 2 chars return nothing; LIKE wildcards escaped); `api_keys.scopes text[] not null default '{}'` with CHECK `scopes <@ {exports:create}` |
| `000067_api_key_scope_guard` | `private.api_keys_scope_guard` (invoker, no API grant; BEFORE INSERT OR UPDATE OF scopes): a signed-in caller may ADD a scope only with that permission in the key's active clinic (`public.has_permission`), else 42501 `API_KEY_SCOPE_FORBIDDEN`; removal and system writers (no JWT user) unrestricted; the `auth.uid()` test is its own statement (05-02c wave note) |

The receiver-column guard (`referrals_target_update_guard`) is unchanged; no policy changed, so the matrix only needed
the fixture listing (`npm run authz:gen -- --check` clean).

## Tests that fail without the change (tool output, `evidence/05a/05-06/`)

- **pgTAP without 000062's trigger and search function** (`pgtap-referrals-rules-without-000062.tap`, the 40-case file
  run in one transaction that drops them, columns kept so fixtures load): **23 of 40 fail** — unlisted, self, unknown
  and postgres-written targets inserted; snapshots without consent inserted (insert and update); re-targeting to an
  unlisted clinic; the search function's shape, definer flag, results, row cap, wildcard, short-query and role
  refusals. The receiver-guard regression cases pass before and after (as intended).
- **pgTAP without 000067's guard** (`pgtap-referrals-rules-without-000067.tap`, same technique on the 48-case file):
  **2 of 48 fail** — the admin creates a scoped key / adds the scope to a key.
- **Specs against the pre-change code** (`specs-without-05-06-code.txt`: `features/dpdp/export.ts` and
  `features/referrals/service.ts` at `70357a3`, migration in place): **9 fail** — export-dto: the real export carries
  keys outside the allow-list (`tenant_id`, `created_by`, `storage_path`, …) and staff/clinic ids; the planted column
  reaches the bundle; export-scope: an unscoped key gets 200 (JSON and PDF), so the following "scoped key audited
  once" and "scope removal" cases and the service-level check fail too; referrals-flow: the refused referral leaves a
  DPDP consent record behind (written before the insert), which then also breaks the existing consent assertion.

## Decisions and deviations

1. **[Rule 2] `api_keys.scopes` column (not named in the plan).** "API key requires an `exports:create` scope" had no
   scope concept to hang on; a closed-set text array with a CHECK is the smallest expand-only shape. Existing keys get
   no scope (they lose `/api/v1` export, which is off in production per PO-16). The check runs in the service
   (`assertExportScope`), so every API-key caller of `exportPatientDpdpArchive` is covered, not just the route.
2. **[Rule 2] Scope-granting guard (000067).** Without it an admin (`clinic:manage` on `api_keys`, but no
   `exports:create`, ruling 01-09) could give a key the scope through the Data API. Added as a second migration after
   05-08's files (coordinated: 05-08 committed 000063-000066 first).
3. **[Rule 1] Consent record order in `createReferral`.** The DPDP consent row and its audit were written before the
   referral insert, so any refused insert (now: an unlisted target) left a consent record for a referral that does not
   exist. Moved after a successful insert.
4. **[Rule 2] v1 referral route.** The trigger's refusal would have surfaced as a 500 echoing the driver message; it
   now answers a fixed 422 (`VALIDATION_ERROR` / `CONSENT_REQUIRED`) and logs by error tag only. The v1 export route
   also stopped echoing raw error messages (fixed 500 text).
5. **No directory picker in the modal.** The create-referral form takes a pasted clinic UUID, not a selection list,
   so per the plan ("otherwise no app change") the UI is unchanged; an unlisted UUID now gets "That clinic is not in
   the referral directory…". The picker over `referral_directory_search` belongs to V2-11 with the directory toggle.
6. **[Rule 3] Fixtures that referred a clinic to itself or to an unlisted clinic.** Guard world: tenant A's seeded
   referral was a self-referral (so the inbound actions had a row); it is now out-of-network, and A's inbound
   referral comes from an unrelated clinic S (`inboundReferral`, `valid-inputs` entry for `acknowledgeReferral`; B
   was not used because the legs compare B's snapshot). Other specs list their target with
   `listInReferralDirectory`; pgTAP fixtures (matrix generator, domain, definer) list clinic B.
7. **Export DTO choices** (`features/dpdp/export-dto.ts`): patient demographics incl. allergies/chronic conditions,
   ABHA/national ids, guardian and emergency contact; visits' non-internal fields + `clinical_notes` content;
   prescriptions + items (no catalogue ids, no PDF path); documents' metadata (no storage path, no uploader);
   invoices + items; payments without staff notes, command ids or recorder; consent records without the recorder.
   Never: tenant ids on rows, staff user ids, storage paths, token hashes, `metadata`/revision/overbook flags, erasure
   fields. The clinic id stays once in `export_metadata` (the data fiduciary).
8. **gitleaks (coordinator).** A synthetic `api_keys.key_prefix` literal in `1dd9640`'s pgTAP fixture matched the
   default `generic-api-key` rule. Not rewritten: the literals were replaced by non-key-shaped values in `6c7c70c` and
   the exact `commit:file:rule:line` fingerprint is pinned in `.gitleaksignore` with a reason. Scan after the commits:
   "no leaks found" (`gitleaks.txt`).

## Product effects to note for the gate

- In-network referrals need the target clinic to opt in (`referral_directory_listed`; runbook SQL until V2-11).
  Unlisting stops new referrals; received ones stay readable and acknowledgeable.
- The DPDP JSON export is smaller: no internal columns (the PDF uses only allow-listed fields and is unchanged).
- `/api/v1` export needs a scoped key (only an owner, or an operator via SQL, can grant it).

## Lanes (tool output in `evidence/05a/05-06/`)

Code at `6c7c70c` (HEAD includes 05-08's commits):
- `static-checks.txt`: typecheck clean; eslint 0 errors (387 warnings, the pre-existing count); inventory 0 flagged;
  `authz:gen --check` clean; schema snapshot `--check` PASS (2170 lines).
- pgTAP lane (`pgtap-lane.tap`, `pgtap-lane.txt`): **22 files, 3023 tests, PASS**; report gate PASS.
  `referrals_rules.test.sql` = 48; `definer_functions.test.sql` +2 legs.
- Full Vitest (`vitest-full.txt`): **234 files, 4600 tests, 4600 passed, 0 failed**.
- E2E PR lane (`e2e-pr.txt`, after `npm run e2e:build`, `e2e-build.txt`; desktop-chrome, Pixel 7, iPhone 15): **220 passed,
  9 skipped** (pre-existing project-scoped skips), **0 retried / 0 flaky**, exit 0.
- gitleaks (`gitleaks.txt`): no leaks found.

## For the 05a gate

Add `referrals_rules.test.sql` (48) to the pgTAP `REQUIRED_FILES`; Vitest gate list may add
`tests/dpdp/export-dto.spec.ts`, `tests/api/export-scope.spec.ts`.

## Self-Check

PASSED. Files present: migrations 000062 and 000067, `features/dpdp/export-dto.ts`, `docs/runbooks/referral-directory.md`,
`supabase/tests/database/referrals_rules.test.sql`, `tests/dpdp/export-dto.spec.ts`, `tests/api/export-scope.spec.ts`,
`tests/helpers/referral-directory.ts`, evidence (`static-checks.txt`, `pgtap-lane.tap`, `pgtap-lane.txt`,
`pgtap-referrals-rules-without-000062.tap`, `pgtap-referrals-rules-without-000067.tap`, `specs-without-05-06-code.txt`,
`vitest-full.txt`, `e2e-build.txt`, `e2e-pr.txt`, `gitleaks.txt`). Commits `2cd19f5`, `b6a527c`, `a3ec57b`, `1dd9640`,
`6c7c70c` are ancestors of HEAD. The local stack is at 000067.
