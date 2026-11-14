---
phase: 05
plan: 05-09b
part: 05b (wave 3)
subsystem: platform admins, platform audit trail, platform.* RPCs (actor rule), SQL runbook
status: complete (local)
migrations: [000085_platform_admin_rpcs]
plan_head_before: 091cc38
commits: [1621d40, docs commit]
code_head_after: 1621d40
requirements: [SUB-01 (transition RPCs, platform.* actor rule, SQL runbook), AI-18 (set_product_availability)]
acceptance: [13 (second half: set_product_availability refuses a product without an active provider price)]
---

# 05-09b record: platform RPCs, the actor rule and the SQL runbook

**Outcome:** done locally. One migration, `000085_platform_admin_rpcs`, adds:
- `public.platform_admins` and `public.platform_audit_log`, both closed to every API role;
- `public.is_platform_admin()` (an active admin row and an `aal2` session);
- the SUB §8.1 actor rule as one internal helper, `private.platform_actor(p_actor)`;
- the five `platform.*` RPCs: `extend_trial`, `set_comp`, `grant_override`, `create_plan_price`,
  `set_product_availability`.

`docs/runbooks/subscriptions-sql.md` holds the vetted snippets (RPC calls only), the admin bootstrap and revocation,
the comp procedure for a pilot clinic and how to read the access level safely. `platform_rpcs.test.sql` (80 cases)
aborts on a 000084 database and passes at 000085; three mutation runs (the verbatim SUB §8.1 block, no `aal2`, no
provider-price rule, leaked grants) each turn named cases red. The pgTAP lane is 38 files / 4018, full Vitest and the
gates are green with 0 retries. Nothing hosted was contacted; every Supabase CLI call used `--local`.

## What shipped

| Object | Contents | Plan step |
|---|---|---|
| `platform_admins` | `user_id` PK → `auth.users` **ON DELETE RESTRICT** (an admin is revoked with `revoked_at`, never deleted by a user delete), `granted_at`, `granted_by` (SET NULL, indexed), `revoked_at` (CHECK ≥ `granted_at`). RLS on, no policy. No privilege for PUBLIC/anon/authenticated; `service_role` SELECT only. Grants and revocations are SQL-only (SUB §9.2) and **audited by an AFTER trigger** (`private.platform_admins_audit`, `platform_admin.granted/updated/deleted`) | 1 |
| `platform_audit_log` | `actor_id`, `channel` (`sql`/`ui`), `action` (dotted, CHECKed), `target_tenant_id`, `payload` (object, ≤ 8 KiB: before/after and reason), `occurred_at`. No FK, so a row outlives the user and the clinic purge (SUB §6.6). `actor_id` is required for every row except a direct SQL change of `platform_admins` (CHECK `platform_audit_log_actor_known`). Append-only **by grants**: no API role and not the service role may INSERT/UPDATE/DELETE/TRUNCATE; the definer RPCs and the trigger are its only writers | 1 |
| `public.is_platform_admin()` | SECURITY DEFINER, `search_path ''`: `auth.jwt() ->> 'aal' = 'aal2'` and an active `platform_admins` row for `auth.uid()`. EXECUTE for `authenticated` only | 1 |
| `private.platform_actor(p_actor)` | The SUB §8.1 actor rule, called first by every RPC. The caller is read from the **session** role (PostgREST's `SET ROLE`, else `session_user`): `postgres`/`service_role` need an active admin in `p_actor` (42501 `PLATFORM_ACTOR_INVALID`), channel `sql`; any JWT caller has `p_actor` ignored and needs `is_platform_admin()` (42501 `PLATFORM_ADMIN_REQUIRED`), actor = `auth.uid()`, channel `ui`. Internal: no API role may execute it | 2 |
| `platform.extend_trial` | `trialing` only; `0 < p_by ≤ 90 days`; `trial_end += p_by`; `access_ends_at` = new trial end + the pending-charge buffer, or no buffer while cancelling (SUB §6.2); `version + 1`; one `trial.extended` event; one audit row | 2 |
| `platform.set_comp` | `comp_until` = a future instant < 5 years, or NULL to clear; refused on `purged`; status unchanged (comp is a flag); `version + 1`; `comp.set`/`comp.cleared` event; audit row | 2 |
| `platform.grant_override` | Upsert of the clinic's override for a known key (`ENTITLEMENT_KEY_UNKNOWN`); a boolean key takes no limit, an enabled limit key needs one; future or no expiry; refused on `purged`; `granted_by` = the actor; `version + 1`; `entitlement.override_set` event; audit row with before/after | 2 |
| `platform.create_plan_price` | A new price version: `flat_recurring` only, GST-exclusive (PO-20), not for a trial or retired plan (`PLAN_PRICE_INVALID`); positive base, rate 0–10000 bp, start now or later (`INPUT_INVALID`); it must start after every existing version of the model; the open version closes exactly at the new start (existing subscriptions keep their row); cadence copied from the previous version (monthly for a first price); audit row | 2 |
| `platform.set_product_availability` | Sets `purchasable` and `visibility`; `purchasable = true` needs a price **active now** with a non-null `provider_plan_id` (`PRODUCT_PRICE_REQUIRED`) and is refused for a trial or retired plan (`PRODUCT_STATE_INVALID`); withdrawing needs no price; audit row with before/after | 2 |
| Grants | Every `platform.*` function: SECURITY DEFINER, `search_path ''`, `REVOKE … FROM PUBLIC, anon, authenticated, service_role`, then `GRANT EXECUTE … TO authenticated, service_role` (SUB §8.1). `platform` has no anon USAGE (000080) | 2 |
| `docs/runbooks/subscriptions-sql.md` | The actor table; admin bootstrap/revocation (raw SQL, audited); the five snippets; comping a pilot clinic (and Pitfall 8); reading the access level with `tenant_access_for_system`; the audit queries | 3 |

Shared artefacts in the same commit:
- `EXPECTED_MIGRATION` 000085;
- `scripts/drift/schema-snapshot.txt` (2547 lines);
- `types/database.ts`;
- `tests/authz/table-matrix.ts`: two targets (`platform_admins`, `platform_audit_log`, `rpc_only` for every operation);
- the regenerated `authz_matrix.test.sql` (2728 → 2816 cells), `authz_completeness.test.sql`, `AUTHZ-MATRIX.md`;
- `table-matrix.spec.ts` (DELETE column and the SUB-01 rule table);
- `definer_functions.test.sql`: `is_platform_admin` classified `exempt` with grantee `authenticated`;
- `lib/db/errors.ts` (+ `tests/db/error-map.spec.ts`): `ENTITLEMENT_KEY_UNKNOWN` → VALIDATION_FAILED, `PRODUCT_PRICE_REQUIRED` → PRECONDITION_FAILED, `PRODUCT_STATE_INVALID` → CONFLICT; the 42501 reasons map to FORBIDDEN by SQLSTATE;
- `tests/setup/teardown.ts` + spec: a run user's `platform_admins` row is removed (as `postgres`) before the user, and the run's platform audit rows are removed with the dedupe keys;
- the pgTAP gate: `platform_rpcs` required, `FLOOR` 3850 → 4018.

## Tests that fail without the change

| File / spec | Cases | Without | With | Covers |
|---|---|---|---|---|
| `platform_rpcs.test.sql` | 80 | at 000084: aborts at the fixture (no `platform_admins`), "Bad plan, planned 80 ran 0" | 80/80 | See the sections below |
| `platform_rpcs.test.sql`, mutant 1: SUB §8.1's block verbatim (`current_user in ('postgres','service_role')`) | | 14-17 fail. 16 shows the hole: a non-admin JWT caller naming a real admin in `p_actor` **succeeds on all five RPCs** (inside a SECURITY DEFINER function `current_user` is the owner) | | The actor rule |
| mutant 2: `is_platform_admin()` without the `aal2` test; `set_product_availability` without the provider-price rule | | 9, 15 (aal1 admin) and 28, 29, 31, 33 (acceptance 13) fail | | MFA; acceptance 13 |
| mutant 3: EXECUTE on `set_comp` and `is_platform_admin` for anon, INSERT on the audit log for service_role, SELECT on `platform_admins` for authenticated | | `platform_rpcs` 3-6, 12, 80 and `definer_functions` 2 fail | | Exact grants |
| `tests/setup/teardown.spec.ts` | +2 | without `removeRunPlatformAdmins` the user delete is refused (asserted in the spec: RESTRICT) | pass | Teardown ordering; malformed ids refused |
| `tests/db/error-map.spec.ts` | +4 | the three new reasons map to CONFLICT (unregistered) | pass | Reason registry |

`platform_rpcs.test.sql`, by section:
1. **Catalogue:** RLS on, no policy; anon/authenticated hold nothing on either table; service_role reads both and writes
   neither; `platform` has exactly the five RPCs, all definer with `search_path ''` and EXECUTE for authenticated and
   service_role; `is_platform_admin` grantee authenticated only; the three helpers executable by no API role.
2. **`is_platform_admin()`:** an aal2 admin → true; the same admin at aal1, a revoked admin, an ordinary user → false;
   anon refused.
3. **Actor rule, every RPC** (one valid call each, rolled back): control as `postgres` with an admin `p_actor` → ok; a
   non-admin, an aal1 admin, a revoked admin, and **a non-admin naming a real admin in `p_actor`** → 42501
   `PLATFORM_ADMIN_REQUIRED`; `postgres` with a null, revoked or non-admin `p_actor`, and `service_role` with a null one
   → 42501 `PLATFORM_ACTOR_INVALID`; `service_role` with an admin → ok; anon cannot reach the schema; no refused call
   left an audit row; **an aal2 admin passing another admin's `p_actor` is recorded as themselves**, channel `ui`, in
   the audit row and the event.
4. **Acceptance 13:** `set_product_availability('ai_assist', true, 'public', <admin>)` as `postgres` → refused, plan
   unchanged; a price without a provider id, and a provider price not active yet, still refused; after
   `create_plan_price` with a provider id active now → allowed, audited with before/after; the derived charge
   (49900 @ 1800 bp = 58882); a trial plan can never be purchasable; Standard itself cannot be re-made purchasable
   until its price has a provider id (V2-13b); price versioning (the seeded Standard price closes at the new start,
   subscriptions keep their row, an overlapping version and inclusive/metered/trial/backdated/zero/out-of-range inputs
   refused).
5. **Transitions:** `extend_trial` moves `trial_end` by the interval, `access_ends_at` = trial end + 24 h (no buffer
   while cancelling), version + 1, exactly one event and one audit row, revives a run-out trial, refuses the other
   states and bad inputs; `set_comp` makes an **expired** clinic `full` (status unchanged) and clearing it locks again,
   one event per change, refusals; `grant_override` gives an active Standard clinic `ai.scribe` with the overriding limit,
   one row per key, re-grant audited with before/after, one event per grant, refusals.
6. **Audit trail:** admin grant and revocation in SQL each wrote a row; an RPC-style row without an actor is refused by
   the CHECK; neither an aal2 admin's JWT nor the service role can write the audit log or the admin list.

## Decisions and deviations

1. **The actor rule reads the session role, not `current_user` (deviation from SUB §8.1's text; proposed R-38
   erratum).** SUB §8.1 shows `if current_user in ('postgres', 'service_role')` inside "every platform.* RPC", and SUB §9.2
   makes every RPC SECURITY DEFINER. Inside a definer function `current_user` is always the owner (`postgres`), so the
   verbatim block sends every JWT caller to the SQL branch, where `p_actor` is trusted: any signed-in user could act as
   any admin (mutant 1, case 16). The helper uses `coalesce(nullif(current_setting('role'), 'none'), session_user)`,
   the pattern `record_payment` uses since 05-11b. The SQL editor must connect as `postgres` (runbook).
2. **One shared helper instead of five copies of the block.** The plan says each function "starts with the actor block
   verbatim"; each RPC's first statement calls `private.platform_actor(p_actor)`, and the pgTAP loop proves the rule on
   every RPC. A sixth `platform` function fails the catalogue test (exact function set) until it is added to the file,
   with its call in the actor-rule loop.
3. **Admin grants and revocations are audited by a trigger.** SUB §9.2: bootstrap by SQL, no UI in v2.0. "Every
   platform write is audited" therefore needs a trigger; the SQL session has no admin identity, so a revocation row
   names the session user in its payload and `actor_id` may be NULL for `platform_admin.*` actions only.
4. **`platform_admins.user_id` is ON DELETE RESTRICT** (plan: "deleted explicitly before users"): an auth-user delete
   cannot silently erase an admin. Teardown removes run users' rows first, as `postgres`.
5. **The audit log has no FK** to users or clinics: it is a statutory platform record (SUB §6.6) that must outlive both.
6. **Typo guards, not policy:** `extend_trial` ≤ 90 days per call; `set_comp` < 5 years; `create_plan_price` refuses
   backdating, overlapping versions, non-`flat_recurring` models (the signature has no unit/tier columns; SUB-11
   extends it) and GST-inclusive prices (PO-20). `grant_override` cannot delete an override; switching a key off is a
   grant with `p_enabled = false` (runbook).
7. **Tenant-scoped RPCs bump `version` for overrides too**, so a reader caching entitlements by version sees the change.
8. **`set_product_availability` checks a price active now.** A provider price scheduled for later does not make a
   product purchasable early; the product is switched on after the price starts.

## Local evidence (tool output, `evidence/05b/05-09b/`)

| Check | Result | File |
|---|---|---|
| New pgTAP file at 000084 / at 000085 | aborts, 0 of 80 run / 80/80 | `pgtap-platform_rpcs-without-000085.tap`, `without-000085-db-version.txt`, `pgtap-lane.tap` |
| Mutants (verbatim §8.1 block; no aal2 + no price rule; leaked grants) | named cases fail; restored, `schema-snapshot --check` PASS after each | `pgtap-platform_rpcs-mutant-*.tap` |
| pgTAP lane + gate (db 000085) | 38 files, **4018/4018**; gate PASS (floor 4018, 38 required) | `pgtap-lane.tap`, `pgtap-report-gate.txt` |
| Full Vitest (tree = `1621d40`) | **248 files, 4887/4887 passed**, 0 failed, 0 skipped; gate PASS (floor 4633, 155 required); teardown removed 208 run tenants and verified none remain | `vitest-summary.json`, `vitest-report-gate.txt` |
| typecheck, `eslint . --quiet`, inventory, `db:drift:local`, `schema-snapshot --check`, `authz:gen` drift spec | all exit 0 / PASS | `static-checks.txt` |

The e2e PR lane is not required for 05-09b (no app code path; 05-PLAN per-plan list); the teardown change runs in
05-09c's e2e lane.

## Threats

- **T-05-33 (spoofed `p_actor`; aal1 admin):** mitigated and proven per RPC (sections 2-3, mutants 1-2).
- **Repudiation:** every platform write (RPC or admin-list change) leaves an append-only audit row that no API role
  or the service role can alter.
- **Elevation via grants:** exact EXECUTE ACLs pinned (`platform_rpcs` 5-7, `definer_functions` 2); no anon path.
- **Selling an unpriced product (AI-18):** refused in SQL whoever calls.
- New SECURITY DEFINER surface: `is_platform_admin` (public, catalogued) and the five `platform.*` RPCs (catalogued in
  `platform_rpcs` 5). The helpers are INVOKER and executable by no API role.

## Open items

- **R-38 errata (PO):** SUB §8.1's actor block (`current_user` → the session role, deviation 1).
- **V2-13b:** `create_plan_price` with a real provider plan id for Standard before Standard can be re-switched; the
  provider's first-charge date when a trial is extended. **V2-13c:** the admin UI calls these RPCs as `authenticated`
  (aal2 enforced inside); an RPC to delete an override if the UI needs one; admin grants stay SQL-only in v2.0.
- 05-09c next: seeds and the v1 drop.
