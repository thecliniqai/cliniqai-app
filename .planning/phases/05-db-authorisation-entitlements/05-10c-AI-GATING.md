---
phase: 05
plan: 05-10c
part: 05b (wave 10)
subsystem: AI-03 database part (owner opt-in, patient objection, kill switch, quota with expiring reservations, grants) and the AI-06 L2 gating contract matrix (database part)
status: complete (local)
migrations: [000091_ai_gating]
plan_head_before: 643c589
commits: [71bedae, docs commit]
code_head_after: 71bedae
requirements: [AI-03 (database part), AI-06 L2 (database part), AI §4.6, C48, PO-21, PO-25, R-33, R-42]
acceptance: [13 (the trialing/active gating half; the catalogue/availability half was 05-09a/05-09b), roadmap test "concurrency tests for … ai_reserve"]
---

# 05-10c record: AI gating in the database

**Outcome:** done locally. Every AI call (V2-12's gateway) now has a database gate it cannot skip, and the quota
cannot be raced:
- `ai_preflight(feature, visit)` answers the AI-06 L2 code in the plan's order: `forbidden` (another clinic's
  visit, or not the active clinic, R-42), `locked`, `forbidden` (role without `consultations:edit`), `killed`,
  `not_entitled`, `not_opted_in`, `patient_objected`, `over_quota`, `ok`. Tenant and patient come from the visit.
- `ai_reserve` runs the same gate, locks the usage row and counts only live reservations; it raises `AI_<CODE>`
  otherwise. Two parallel calls at limit − 1 give one id and one `AI_OVER_QUOTA` (8 of 8 rounds).
- `ai_commit` adds exactly one unit; `ai_release` adds none; both only for the caller's clinic.
- `set_ai_opt_in` is owner-only (active, full clinic) and audited. The patient objection flag is stamped by a trigger.
- No API role can write `tenant_ai_settings`, `ai_usage_monthly` or `ai_quota_reservations`.
- **Acceptance 13, gating half:** a `trialing` clinic has `ai.scribe` with exactly 1,500 drafts over the whole trial
  (1,499 used → `ok`, 1,500 → `over_quota`); an `active` Standard clinic gets `not_entitled` (PO-25 default).

One migration, `000091_ai_gating`. Lanes: pgTAP 45 files / 7838 (gate PASS, floor 7838), full Vitest 257 files / 5063 (gate PASS, floor re-measured to
4810), e2e PR lane 260 passed (8 of them the annotated known-bug failures), 9 skipped, 0 unexpected, 0 flaky, 0 retried. Nothing
hosted was contacted; no AI provider was called.

## What shipped

| Area | Contents | Plan step |
|---|---|---|
| `public.tenant_ai_settings` | `tenant_id` PK (→ tenants, cascade), `enabled` (default false), `accepted_terms_version` (`^[A-Za-z0-9._-]{1,40}$`), `accepted_by` (→ auth.users, NO ACTION, indexed), `accepted_at`, `updated_at`; CHECK enabled ⇒ accepted fields set. RLS: SELECT `tenant_ids_with('clinic:view')`; `REVOKE ALL` then SELECT only for `authenticated` | 1 |
| `public.set_ai_opt_in(p_tenant, p_enabled, p_terms_version)` | SECURITY DEFINER, `search_path = ''`, `lock_timeout` 5 s. Owner of the active clinic at access level `full` (`authz.full_tenant_ids()`), else 42501 `AI_OPT_IN_OWNER_ONLY` (a locked clinic reads as another clinic, 05-10a). Enabling needs a terms version (`AI_TERMS_VERSION_INVALID`); it stamps `accepted_by = auth.uid()`, `accepted_at = now()`; disabling keeps the last acceptance. One audit row per call (`ai.opt_in.enabled` / `ai.opt_in.disabled`, metadata: terms version only) | 1 (R-33) |
| `public.patients` | `ai_processing_objected boolean not null default false`, `objected_at`, `objection_recorded_by` (→ auth.users, NO ACTION, indexed); CHECK flag ⇔ `objected_at` set. BEFORE INSERT/UPDATE trigger `patients_ai_objection_stamp` (invoker, no API grant): on a flag change it stamps the time and `auth.uid()`; on any other write it restores the stamp columns, so a caller cannot forge them. Writing the flag follows the existing patients policies (`patients:edit`, every clinic role per `matrix.ts`) | 1 |
| `public.ai_usage_monthly`, `public.ai_quota_reservations` | Usage PK (tenant_id, period, feature), `units ≥ 0`; reservations (id, tenant_id, feature, period, created_at, expires_at > created_at), index (tenant_id, feature, period, expires_at). RLS on, no policy, `REVOKE ALL` from PUBLIC/anon/authenticated | 1 |
| `private.ai_gate(p_feature, p_visit_id)` | The L2 contract (internal, invoker, no API grant). Unknown feature (not a boolean `ai.*` entitlement key) raises `AI_FEATURE_UNKNOWN`. Kill switch: `platform_settings.ai_features -> feature = true`; a missing flag counts as off. Entitlement and limit through `billing_internal.has_entitlement` / `entitlement_limit(<feature>.monthly_drafts)`. Period: `trial:<clinic-local date of trial_start>` while `trialing` (PO-21), else the clinic-local month `YYYY-MM` (`tenant_local_date`, 05-08) | 2 |
| `public.ai_preflight`, `public.ai_reserve`, `public.ai_commit`, `public.ai_release` | SECURITY DEFINER, `search_path = ''`, EXECUTE for `authenticated` only. `ai_reserve`: timeout clamped 10…300 s, `INSERT … ON CONFLICT DO NOTHING` then `SELECT … FOR UPDATE` on the usage row, count of reservations with `expires_at > now()`, reservation `expires_at = now() + timeout + 30 s`; `lock_timeout` 5 s. `ai_commit`/`ai_release`: the active clinic's reservation with `consultations:edit` (at any access level: a call reserved before a lock is still metered); another clinic's reservation is P0002 `AI_RESERVATION_NOT_FOUND` | 2 |
| `lib/db/errors.ts` | `RPC_REASON_CODES`: `AI_FEATURE_UNKNOWN`, `AI_TERMS_VERSION_INVALID` → VALIDATION_FAILED; `AI_FORBIDDEN` → FORBIDDEN; `AI_LOCKED` → SUBSCRIPTION_LOCKED; `AI_KILLED`, `AI_NOT_ENTITLED`, `AI_NOT_OPTED_IN`, `AI_PATIENT_OBJECTED`, `AI_OVER_QUOTA` → PRECONDITION_FAILED | 2 |
| Matrix, chores | `tests/authz/table-matrix.ts` + the three tables (opt-in `selectOnly(perm('clinic:view'))`, usage and reservations `opsRules`), regenerated `authz_matrix` (5952 → 6240 cells), `authz_completeness`, `access_lock_rls`, `AUTHZ-MATRIX.md`; `types/database.ts`; `EXPECTED_MIGRATION = "000091"`; schema snapshot (2629 lines); `tests/setup/teardown.ts` `NO_ACTION_USER_REFS` + `tenant_ai_settings.accepted_by`, `patients.objection_recorded_by`; `definer_functions.test.sql` classifies the five new definer functions (bound; preflight/reserve/opt-in refuse a locked clinic, commit/release neutral) with 2 dual-member and 4 access-level legs | chores |

## Tests that fail without the change

| File / spec | Cases | Without (evidence: `evidence/05b/05-10c/mutants-summary.txt`) | With |
|---|---|---|---|
| `ai_gating_l2.test.sql` (new; AI-06 L2 database part) | 115: the generated table, 6 subscription states × opt-in × objection × kill switch × quota = 96 rows against an oracle written in the test (outcomes: 32 killed, 32 locked, 16 not_entitled, 8 not_opted_in, 4 patient_objected, 2 over_quota, 2 ok); trialing 1,499 → ok and 1,500 → over_quota; month usage does not count against the trial; active Standard → not_entitled (acceptance 13); override limit; receptionist, nurse, admin → forbidden; owner → ok; other clinic's visit, dual member acting in B, a user of no clinic, an unknown visit → forbidden; anon denied; deferred product not entitled; unknown feature raises; missing kill-switch flag → killed; opt-in row off → not_opted_in | mutants: no objection check → 4 fail; kill switch open when the flag is missing → 1; any clinic's visit → 1 (+1 definer leg); no access-level check → 32 (+2 definer legs); role unchecked → 3; trial booked to the month → 3; objection trigger dropped → 48 (the CHECK refuses the unstamped flag) | 115/115 |
| `ai_quota.test.sql` (new) | 41: expired vs live reservations; reserve at the limit; trial period key, IST month after the trial, the clinic's own zone; timeout clamps (40 s / 330 s); two sequential reservations at limit − 2 / limit − 1; reserve raises AI_FORBIDDEN/LOCKED/KILLED/NOT_ENTITLED/NOT_OPTED_IN/PATIENT_OBJECTED; commit +1 (and creates the row), release +0, unknown release false, another clinic's reservation not committable or releasable, receptionist/nurse refused, commit after a lock still metered; opt-in owner only (admin, doctor, other owner, locked owner refused), terms version required, audit row, disable keeps acceptance, every role reads only its clinic's row; objection stamp, stamp columns not writable, another clinic cannot set it; no API-role DML; anon and private helpers not executable | mutants: expired reservations counted → 1 fail; trial booked to the month → 4; opt-in for any role → 2; commit of any clinic's reservation → 1; objection trigger dropped → 3; INSERT/UPDATE granted on `ai_usage_monthly` → 1 (+1 `authz_completeness` grant check); role unchecked → 1; no objection check → 1; no access-level check → 1 | 41/41 |
| `tests/ai/ai-reserve-concurrency.spec.ts` (new; roadmap concurrency test) | 4: precondition `ok`; at limit − 1 two parallel PostgREST `ai_reserve` calls (owner and doctor sessions) → exactly one id and one `AI_OVER_QUOTA`, mapped to PRECONDITION_FAILED, one live reservation (8 rounds); reserve → commit gives 1,500 and `over_quota`; locked clinic → `AI_LOCKED` → SUBSCRIPTION_LOCKED | `ai_reserve` without `FOR UPDATE` (plus a 0.3 s sleep before the insert to widen the window) → the parallel case fails; **control:** the same sleep with the row lock kept → 4/4 pass, so the lock is what serialises | 4/4 |
| `definer_functions.test.sql` | 71 (+6) | the classification/grant `set_eq`s fail for any new definer function without its row; locked legs per mutant above | 71/71 |
| `authz_matrix.test.sql` / `tests/authz/table-matrix.spec.ts` | 6240 (+288) / 32 (+3) | `usage-writable-by-authenticated` mutant fails the grants and matrix cells | pass |

## Decisions and deviations

1. **The gate is one internal function** (`private.ai_gate`, invoker, no API grant) shared by `ai_preflight` and
   `ai_reserve`, so the preflight answer and the reservation refusal cannot drift apart.
2. **Kill switch fails closed:** a feature key missing from `platform_settings.ai_features` is `killed` (the plan says
   "false → killed"; absent is treated the same).
3. **`ai_commit`/`ai_release` need `consultations:edit` in the active clinic but not access `full`:** a call that was
   reserved before a lock is still metered (and an expired-but-present reservation still commits one unit; it only
   stops counting against the quota). Recorded as `neutral` in the 05-10a access classification.
4. **Reason codes:** `ai_reserve` raises `AI_` + the preflight code (P0001) so the app can map each one;
   `AI_LOCKED` maps to the existing SUBSCRIPTION_LOCKED app code (the PWA reacts to it, V2-06 D-8).
5. **Patient objection writes follow `patients:edit`**, which every clinic role holds in `matrix.ts` (AI §4.6 names
   doctor or receptionist). The plan's draft test idea "a nurse cannot set it" was wrong for this matrix; the test now
   proves the clinic binding instead (another clinic's doctor updates 0 rows).
6. **No app caller:** the existing v1 actions (`features/ai/actions.ts`: SOAP draft, catch-up summary) are still gated
   only by `AI_ENABLED` (off unless configured) and `requirePermission`; wiring `requireEntitlement` and
   `ai_reserve`/`ai_commit` into them is AI-03's app part in V2-12 (roadmap). Raised as an open item.
7. **Expired-reservation cleanup** is not scheduled (R-33, V2-12): reservations stop counting at `expires_at`.

## Local evidence (tool output, `evidence/05b/05-10c/`)

| Check | Result | File |
|---|---|---|
| pgTAP lane + gate (db 000091) | **45 files, 7838/7838**; gate PASS (floor 7838, 45 required) | `pgtap-lane.tap`, `pgtap-report-gate.txt` |
| Full Vitest | **257 files, 5063/5063**, 0 failed, 0 skipped; gate PASS (floor 4810, 163 required). First full run: 5062/5063, the one failure was 05-10b's gate spec pinning the old floor message (fixed in `a7a0dae`) | `vitest-summary.json`, `vitest-report-gate.txt`, `vitest-first-run-gate-spec-failure.json` |
| e2e PR lane, fresh `e2e:build` | **260 passed** (incl. 8 annotated known-bug failures), 9 skipped, **0 unexpected, 0 flaky, 0 retried** | `playwright-summary.json`, `e2e-pr-tail.txt` |
| Mutants (11 pgTAP, 1 Vitest + 1 control) | each fails named cases; the control (row lock kept, same sleep) passes | `mutants-summary.txt`, `pgtap-mutant-*.tap`, `vitest-mutant-*.txt`, `mutants.py` |
| Restore after the mutants | `schema-snapshot --check` PASS | `snapshot-check-after-mutants.txt` |
| typecheck, `eslint --quiet`, inventory, ai-l1, `db:drift:local`, `schema-snapshot --check`, `authz:gen --check`, migration immutability (base `643c589`), `env-example --check` | all exit 0 / PASS | `static-checks.txt` |

**Shared stack.** One `supabase db reset --local` for 05-10c (2026-11-15T00:43:54Z, under the test-run lock) to apply
000091, followed by `npm run seed:local` (no `--reset`; `access summary: full=1 locked=0 onboarding=0`). One mutant run
under the test-run lock (nested Vitest lock directory), each object restored from 000091's text.

## Threats

- **T-05-37 (quota race or abuse):** mitigated: the usage row lock, live-reservation counting with expiry, the
  timeout clamp, the kill switch; proven by the concurrency spec and its no-lock mutant.
- **T-05-38 (AI for an objecting patient or without owner opt-in):** mitigated in SQL (`patient_objected`,
  `not_opted_in` before any quota is reserved); the opt-in is owner-only and audited; the objection stamp cannot be
  forged.
- New surface: five `authenticated` RPCs. Each derives the clinic from the visit or the reservation and binds it to
  the active clinic; none returns tenant data beyond a code, a reservation id or a unit count; `set_ai_opt_in`
  returns the clinic's own settings row.

## Open items

- **V2-12 (AI-03 app part):** call `ai_preflight`/`ai_reserve`/`ai_commit`/`ai_release` and `requireEntitlement` from
  the gateway; wire the existing v1 AI actions through them or remove them; opt-in UI (owner) and objection UI
  (registration and patient page); the "Preview" label; the `ai.reservations_cleanup` job.
- **05b gate:** the pgTAP floor and Vitest floor are updated by this plan (numbers above); independent and adversarial
  reviews (billing/entitlements review C covers AI gating and quota races).
