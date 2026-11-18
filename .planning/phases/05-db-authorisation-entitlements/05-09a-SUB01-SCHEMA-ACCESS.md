---
phase: 05
plan: 05-09a
part: 05b (wave 2)
subsystem: SUB-01 schema, access and entitlement functions, catalogue and AI-18 seeds
status: complete (local)
migrations: [000080_billing_schemas, 000081_subscription_catalogue, 000082_tenant_subscriptions, 000083_billing_access_functions, 000084_subscription_seeds]
plan_head_before: cef0bd7
commits: [88ac443, docs commit]
code_head_after: 88ac443
requirements: [SUB-01, AI-18, PO-20, PO-21, PO-25]
acceptance: [8 (function half), 9, 12, 13 (entitlements + only Standard purchasable), note (create_clinic_with_owner → incomplete)]
---

# 05-09a record: subscription schema, access level, entitlements, catalogue

**Outcome:** done locally. Five migrations (000080–000084) add the following, as SUB §6–§8 and the plan specify:
- two non-exposed schemas;
- the catalogue (plans, versioned prices, entitlement keys, plan entitlements, per-clinic overrides);
- the clinic's base subscription with its append-only event log and the single settings row;
- the access and entitlement functions with their caller-bound wrappers;
- the idempotent Standard / trial / AI-18 seeds.

Every clinic, however it is created, now starts with exactly one `incomplete` subscription row. The RLS helpers do not
read the access level yet (05-10a), so no user path changes. The five new pgTAP files (143 cases) fail on a 000079
database and pass at 000084. The pgTAP lane is 37 files / 3850. Full Vitest (248 files / 4881) and the e2e PR lane (220 passed) are green, with 0
retries. Nothing hosted was
contacted; every Supabase CLI call used `--local`.

## What shipped, by migration

| Migration | Contents | Plan step |
|---|---|---|
| 000080 `billing_schemas` | `billing_internal` (USAGE: service_role only) and `platform` (USAGE: authenticated, service_role; never anon). PUBLIC loses ALL on both schemas. Per-schema default privileges revoke function EXECUTE from PUBLIC. Neither schema is in `[api] schemas`. Both join `SNAPSHOT_SCHEMAS`, so their ACLs are in the committed snapshot and the nightly hosted drift check | 1 |
| 000081 `subscription_catalogue` | The tables: `plans` (SUB §7.1 columns, `purchasable`, `visibility`, `trial_plan_id`, grace days); `plan_prices` (five billing models, integer paise, `charge_amount_paise` GENERATED as `base + round(base * bp / 10000.0)`, versioned window `active_from`/`active_until`); `entitlement_keys`; `plan_entitlements`; `tenant_entitlement_overrides` (unique per clinic and key, `granted_by` → auth.users ON DELETE SET NULL). Access: RLS on all of them, REVOKE ALL from PUBLIC/anon/authenticated. Only `authenticated` gets SELECT, and only on the catalogue rows of plans that are not `hidden`; overrides have no tenant access. Every FK has its index | 2 |
| 000082 `tenant_subscriptions` | The tables: `tenant_subscriptions` (PK `tenant_id`, every SUB §7.1 column incl. mandate columns, `comp_until`, `access_ends_at`, `trial_consumed`, `version`; seven-state CHECK); `subscription_events` (append-only by grants: no UPDATE/DELETE/TRUNCATE for any API role **or the service role**; no trigger, Pitfall 5); `platform_settings` (single row: `id boolean PK DEFAULT true CHECK (id)`). SELECT on the subscription and its events uses `authz.billing_tenant_ids()` (owner/admin of the active clinic, R-26). The AFTER INSERT trigger `tenants_create_subscription` (SECURITY DEFINER, `private`, no EXECUTE grant) inserts `incomplete` with `ON CONFLICT DO NOTHING` (R-24). Backfill: existing clinics get `incomplete` | 3 |
| 000083 `billing_access_functions` | `billing_internal.tenant_access_level` (SUB §6.2 body verbatim, SECURITY DEFINER); `resolve_entitlement` (the SUB §7.2 order); `has_entitlement`, `entitlement_limit`; `start_trial` (T1, SUB §4 IST anchor, buffer from settings, event row, `version + 1`, row lock + `lock_timeout`). All service_role only. `public.my_tenant_access` and `public.my_entitlements` are SECURITY DEFINER wrappers bound to the caller's own clinics, with no `p_now`, executable by `authenticated` only. `public.tenant_access_for_system` (INVOKER, service_role only, R-28). Machine reasons: `SUBSCRIPTION_STATE_INVALID`, `TRIAL_ALREADY_CONSUMED`, `PLAN_PRICE_INVALID` (P0001, registered in `RPC_REASON_CODES`); `SUBSCRIPTION_NOT_FOUND` (P0002) | 4 |
| 000084 `subscription_seeds` | Idempotent seeds. Entitlement keys: the 21 keys of AI §6.2 / SUB §7.3. Plans: `standard`, `standard_trial`, `ai_assist`, `ai_voice_receptionist`. Price: one Standard `flat_recurring` price (149900 / 1800 bp / exclusive / INR / month ×1 / razorpay / no provider id). The plan-entitlement grid: Standard = Smart Assist + core + the messaging quota, AI off with 0 drafts (PO-25); trial = Standard + ai.scribe with 1,500 drafts (PO-21); the deferred AI keys are present and off on every plan. `platform_settings` row with the SUB §4 defaults and every `ai.*` boolean flag in `ai_features` | 5 |

Shared artefacts in the same commit:
- `EXPECTED_MIGRATION` 000084;
- `scripts/drift/schema-snapshot.txt` (now 2497 lines, two new schemas);
- `types/database.ts`;
- `tests/authz/table-matrix.ts`: 8 targets, with fixture clinics A and B set `trialing` through a new optional `fixtureSql`, which `scripts/gen-authz-pgtap.ts` emits after the fixture rows;
- the regenerated `authz_matrix.test.sql` (2376 → 2728 cells), `authz_completeness.test.sql` and `AUTHZ-MATRIX.md`;
- `definer_functions.test.sql` (the three new definer functions classified, with exact grantees);
- `lib/db/errors.ts`;
- the pgTAP gate (5 files required, floor 3850) and its spec.

## Tests that fail without the change

All five files were run on a stack reset to `000079` (`db reset --local --version 000079`, under the test-run lock),
then again after a full reset (`evidence/05b/05-09a/`).

| File | Cases | At 000079 | At 000084 | Covers |
|---|---|---|---|---|
| `billing_access.test.sql` | 45 | aborts (no `billing_internal`): Dubious | 45/45 | The access levels, with time travel through `p_now`:<br>- `incomplete` → onboarding;<br>- `trialing` before trial_end, inside the buffer, at and after `access_ends_at`;<br>- a cancelled trial locks exactly at `trial_end`;<br>- active and cancelling locks at `current_period_end`; active past the period + buffer;<br>- `past_due` locks at grace or at halt, whichever is first; grace 0;<br>- comp on `incomplete` and on `expired` is full; an elapsed comp is locked; comp on `purged` is none;<br>- `archived` is locked; a NULL `access_ends_at` is locked; no row (or an unknown clinic) is NULL.<br><br>`start_trial`:<br>- the SUB §4 worked example (24 Nov 2026 10:00 IST);<br>- the +24 h buffer and buffer 0;<br>- the event, the version and the refusals.<br><br>**Acceptance 8 (function half); roadmap "time-travel pgTAP"** |
| `billing_entitlements.test.sql` | 30 | aborts: Dubious | 30/30 | - `trialing` → ai.scribe on, 1,500 drafts;<br>- active Standard → off and 0;<br>- an override grants its own limit, stops at `expires_at`, and can switch a key off;<br>- locked and onboarding clinics get no key, override or not;<br>- comp without a price has no keys (Pitfall 8), and has the Standard keys once the price is set;<br>- `my_entitlements` returns the own clinic only, and anon is refused.<br><br>**Acceptance 13 (entitlement half)** |
| `billing_catalogue.test.sql` | 30 | aborts: Dubious | 30/30 | - The generated charge: 176882 for Standard, other values computed, half-up rounding; inclusive refused; not writable.<br>- Purchasable = {standard}.<br>- The AI products are `coming_soon` with no active provider price.<br>- Trial plan wiring.<br>- The key set and the plan grid (PO-21, PO-25).<br>- The settings row and its flags.<br>- What a signed-in user lists (hidden plan excluded); anon is refused.<br><br>**Acceptance 12, 13 ("only Standard purchasable")** |
| `billing_grants.test.sql` | 24 | the sanity case fails (no `billing_internal` functions: cases 2-4 pass vacuously, which is why case 1 exists), then aborts at case 5 (no schema) | 24/24 | Catalogue loops:<br>- no billing_internal function is executable by authenticated, anon or PUBLIC; schema USAGE; `search_path ''`;<br>- no write privilege for API roles on any gating table; SELECT exactly where the matrix says; RLS on;<br>- events append-only, including for the service role;<br>- the wrappers' grants; `my_tenant_access(B)` for a member of A returns NULL;<br>- a direct `billing_internal` call is denied.<br><br>**Acceptance 9** |
| `subscription_invariant.test.sql` | 14 | test 1 fails (no trigger), then aborts | 14/14 | Exactly one `incomplete` row, whoever creates the clinic: a service-role insert, a postgres insert, or `create_clinic_with_owner`.<br>- The PK refuses a second row, and `ON CONFLICT` never resets an existing one.<br>- Backfill complete.<br>- The tenant cascade removes the subscription and its events.<br><br>**Roadmap note** |

**Negative proof of the acceptance 9 loop:** `GRANT EXECUTE ON FUNCTION billing_internal.has_entitlement … TO
authenticated`, run under the lock and revoked straight after, makes case 2 fail and name the function
(`pgtap-billing_grants-negative-execute-granted.tap`). The schema snapshot check passed afterwards.

**Matrix (acceptance 1, 05b share):** the eight new tables have a matrix row each:
- catalogue tables: SELECT for every signed-in user;
- `tenant_subscriptions`, `subscription_events`: SELECT through the `billing` rule (owner/admin of the active clinic);
- overrides and settings: no access;
- every write is `rpc_only`.

`authz_completeness` holds against the catalogue, including the privilege check. `table-matrix.spec.ts` pins the
rules: only `owner_a` and `admin_a` read the clinic's subscription and events; no principal reaches overrides or
settings; the fixture clinics are `trialing`.

## Decisions and deviations

1. **SECURITY DEFINER only where specified.** `tenant_access_level` is DEFINER, as SUB §6.2 shows. The other
   `billing_internal` functions (`resolve_entitlement`, `has_entitlement`, `entitlement_limit`, `start_trial`) are
   INVOKER. Their callers are the service role, which has full table privileges, and definer functions owned by
   postgres (the wrappers now; 05-10a's helpers later). All are service_role only. `tenant_access_for_system` is
   INVOKER (plan checklist item 2).
2. **The wrappers are member-bound, not active-clinic-bound.** `my_tenant_access`/`my_entitlements` answer for any of
   the caller's own clinics, through `authz.member_tenant_ids()`. 05-05 limits that helper to active memberships, so
   SUB §6.2's "active memberships" follows without a rewrite. The layout and the clinic switcher must resolve a locked
   clinic (R-40). A dual member therefore reads either of their own clinics' levels, never another clinic's
   (`billing_grants` cases 17–21).
3. **`entitlement_limit` semantics.** An unexpired override decides: its limit if enabled, else 0. Otherwise the
   result is the largest limit among the applicable plan sources, which today is one plan (base or trial); SUB-11
   add-ons will join that maximum. A NULL limit reads as 0. SUB §7.2 says "same order … largest applicable"; this
   keeps "override wins" from the same order.
4. **`tax_inclusive` is CHECKed false.** The generated charge expression (plan step 2, verbatim) assumes an exclusive
   base. PO-20 fixes v2.0 pricing as exclusive. An inclusive product needs its own expression when one exists.
5. **`start_trial` refusals beyond the plan text.** Besides "not incomplete", it also refuses a second trial
   (`trial_consumed`, SUB §4 "one trial per clinic") and a price that is not active at `p_now` or not a purchasable,
   active base plan with trial days (`PLAN_PRICE_INVALID`). Three reasons are registered in `RPC_REASON_CODES`
   (checklist item 9).
6. **`subscription_events` is append-only for the service role too.** UPDATE/DELETE/TRUNCATE are revoked from
   service_role. The tenant cascade runs as the table owner, so teardown still works (`subscription_invariant`
   case 14).
7. **`messaging.monthly_quota` has no number.** SUB-D2 says "set by SQL before go-live"; nothing reads it before then.
   It is seeded enabled with a NULL limit, which reads as 0.
8. **`ai_features` flags are all `true`.** AI §4.6: the kill switch is "enabled per key"; entitlements still decide who
   may use a feature.
9. **The matrix generator gained `fixtureSql`.** The trigger creates the fixture clinics' subscription rows, so the
   fixture cannot insert them. Without the trigger, nothing could set them `trialing` (plan: "fixture subscription
   rows `trialing` for tenants A and B"), so a target can now carry one postgres statement run after the fixtures.
10. **The pgTAP gate is raised per plan.** 05b execution rule: 5 files added to `REQUIRED_FILES`. The arithmetic for
    `FLOOR` 3355 → 3850: 3355 + 352 matrix cells + 45 + 30 + 30 + 24 + 14.
11. **`platform_admins` / `platform_audit_log` are not created here.** They come in 05-09b with their first users
    (`is_platform_admin`, the `platform.*` RPCs), as that plan specifies.

## Local evidence (tool output, `evidence/05b/05-09a/`)

| Check | Result | File |
|---|---|---|
| New pgTAP files at 000079 / at 000084 | all five fail / 143/143 | `pgtap-*-without-000080-000084.tap`, `without-000080-000084-db-version.txt`, `pgtap-lane.tap` |
| Acceptance 9 loop negative proof | case 2 fails, naming the leaked function | `pgtap-billing_grants-negative-execute-granted.tap` |
| pgTAP lane + gate (db 000084) | 37 files, **3850/3850**; gate PASS (floor 3850, 37 required) | `pgtap-lane.tap`, `pgtap-report-gate.txt` |
| Full Vitest (db 000084; tree committed unchanged as `88ac443`) | **248 files, 4881/4881 passed**, 0 failed, 0 skipped; gate PASS (floor 4633, 155 required); teardown removed 208 run tenants and verified none remain | `vitest-summary.json`, `vitest-report-gate.txt` |
| e2e PR lane (desktop, Pixel 7, iPhone 15), fresh `e2e:build` at `88ac443` | **220 passed, 9 skipped, 0 failed, 0 flaky, 0 retried** | `playwright-summary.json`, `e2e-pr-tail.txt`, `e2e-build-tail.txt` |
| typecheck, `eslint . --quiet`, inventory, `db:drift:local`, `schema-snapshot --check`, `authz:gen` drift spec | all exit 0 / PASS; `migration-immutability --base d670b62` PASS (78 applied unchanged, 6 new above 78) | `static-checks.txt` |
| Per-file counts of the new and changed pgTAP files in the lane | as tabled above, plus `authz_matrix` 2728, `definer_functions` 34, `contract_05a` 18 | `pgtap-new-files.txt` |

## Threats

New surface, all closed by default (R-13):
- 8 tables, each with RLS on and a matrix row;
- 2 schemas outside the Data API;
- 3 new SECURITY DEFINER functions (`tenant_access_level` in `billing_internal`; `my_tenant_access` and
  `my_entitlements` in `public`), each catalogued (the two `public` ones in `definer_functions`) with exact grantees.

Threat by threat:
- **T-05-24/T-05-25 (a client chooses the time or the clinic):** no `p_now` is reachable by a client, and the
  wrappers derive the clinic set from the session.
- **Elevation through the catalogue (AI §4.6):** no API role can write any gating table (catalogue loop).
- **Tampering with the lifecycle log:** events are append-only for every role except the owner-run cascade.
- **Information disclosure:** the catalogue exposes only non-hidden products and their public price. Provider plan ids
  are not secrets. A clinic's subscription row is visible only to its owner/admin in the active clinic.
- **Every new clinic starts `incomplete`** (onboarding). That changes nothing until 05-10a binds the helpers to the
  access level. 05-09c seeds every test and demo clinic `trialing` or comped first (acceptance 11).

## Open items

- **05-09b:** `platform_admins`, `platform_audit_log`, `is_platform_admin()`, the `platform.*` RPCs (incl.
  `set_product_availability`'s provider-price refusal, acceptance 13 second half), the runbook.
- **05-09c:** `seedTenantSubscription`, demo/dev comp with the Standard price (Pitfall 8), the v1
  `subscriptions`/`payment_records` drop, the flip dry run. Until then the local demo clinic and every test clinic is
  `incomplete`, which is harmless before 05-10a.
- **05-10a:** helper bodies read `tenant_access_level` (`full_tenant_ids`, `billing_tenant_ids`), the access-level
  matrix principals, and `tenant_access_for_system` callers.
- **R-38 errata (PO):** SUB §7.1 `active_to` is spelled `active_until` here (as in 05-PLAN step 2); SUB §7.2's helper
  name is `authz.billing_tenant_ids()` (R-26).
