---
phase: 05
plan: 05-05
part: 05b (wave 5)
subsystem: AUTH-05 membership status, staff removal, session and API-key revocation
status: complete (local)
migrations: [000087_membership_status]
plan_head_before: b6ffb27
commits: [29358dc, docs commit]
code_head_after: 29358dc
requirements: [AUTH-05 (backend), SEC-07]
acceptance: [4 ("a removed member reads 0 rows with a still-valid JWT"): full]
---

# 05-05 record: membership status, removal, session and key revocation

**Outcome:** done locally. One migration, `000087_membership_status`:
- `memberships.status` (`active` | `suspended` | `removed`) with `removed_at` / `removed_by`, and
  `invitations.revoked_at` / `revoked_by` (expand step for 05-07a);
- the five `authz` helper **bodies** read only `active` memberships (R-14: same signatures, no policy rewritten), so a
  removed or suspended member with a still-valid JWT reads 0 rows and writes nothing anywhere (acceptance 4);
- `public.remove_member(p_membership_id, p_reason)` removes a member and revokes their API keys, pending invitations and
  every Auth session (fail-soft, R-43), with one audit row of counts;
- `public.session_is_live()` (AUTH §3.5);
- `change_member_role` ignores non-active rows; `consume_invitation` refuses a revoked invitation.

The app gains `removeStaff` (backend only; the staff UI and J-A6 are V2-11's, R-31), and its doctor/staff lookups use
active members only. The generated matrix gains the two principals (2728 → 3224 cells); `remove_member.test.sql` (81)
is new. pgTAP 40 files / 4513, full Vitest and the e2e PR lane green with 0 retries (numbers below). Nothing hosted was
contacted; every Supabase CLI call used `--local`.

## What shipped

| Object | Contents | Plan step |
|---|---|---|
| `memberships.status`, `removed_at`, `removed_by` | `status text not null default 'active'`, CHECK `memberships_status_check` (the three values) and CHECK `memberships_removed_at_status` (`removed` ⇔ `removed_at` set). `removed_by` → `auth.users` (NO ACTION, indexed `idx_memberships_removed_by`). None of the three is in the member UPDATE column grants (000019), so no member can reactivate themself (pinned). Rows are never deleted: since 05-03 a doctor's membership is the RESTRICT parent of their visits and prescriptions (05a triage) | 1 |
| `invitations.revoked_at`, `revoked_by` | `revoked_by` → `auth.users` (NO ACTION, indexed); column SELECT granted to `authenticated` (the staff page hides revoked invitations); `token_hash` stays unreadable (000071) | 1 |
| Helper bodies | `authz.active_tenant_id()` (header clinic and the sole-membership fallback), `member_tenant_ids()`, `full_tenant_ids()`, `tenant_ids_with()`, `billing_tenant_ids()`: `AND m.status = 'active'`. Every policy, storage class and bound definer function (`log_audit`, `issue_queue_token`, `record_payment`, the share and enqueue RPCs, `has_permission`, `my_tenant_access`, …) goes through them, so none needed a change. A member removed in clinic A but active in B: a header naming A falls back to B (the sole active clinic), as a stale cookie does today | 1 |
| `change_member_role` | A removed/suspended target is `not_found`; the caller's role is read from an active row; the last-owner count is of active owners (a removed co-owner does not count) | 1 |
| `public.remove_member(uuid, text) → jsonb` | SECURITY DEFINER, `search_path ''`, `lock_timeout 5s`, EXECUTE `authenticated` only. Actor = `auth.uid()` (no JWT → 42501 `ACTOR_INVALID`; no actor parameter exists). Order of checks: reason 1–500 chars, no control characters (P0001 `INPUT_INVALID`); the target row's clinic must be the caller's active clinic, else P0002 `MEMBER_NOT_FOUND` (another clinic's ids are never confirmed); the caller's active role there holds `staff:invite`, else 42501 `STAFF_REMOVE_FORBIDDEN`; an owner/admin target needs an owner caller, else 42501 `OWNER_REQUIRED`; already removed → P0001 `MEMBER_NOT_ACTIVE`; the last active owner (owners locked as `change_member_role` does) → P0001 `LAST_OWNER`; self → P0001 `SELF_REMOVAL`. Effects in one transaction: status `removed`, `removed_at`, `removed_by` = caller; the target's live API keys **of that clinic** `revoked_at = now()`; the target's pending invitations of that clinic `revoked_at/by`; `DELETE FROM auth.sessions WHERE user_id = target` inside `BEGIN … EXCEPTION WHEN insufficient_privilege` (refresh tokens cascade; a refusal leaves the removal in place and reports NULL); one `audit_logs` row `staff.removed` (actor, actor role, entity = membership; metadata `target_user_id`, `role`, `reason`, `keys_revoked`, `invites_revoked`, `sessions_revoked`). Returns `{user_id, keys_revoked, invites_revoked, sessions_revoked}` | 1 |
| `public.session_is_live() → boolean` | SECURITY DEFINER, `authenticated` only: the caller's JWT `session_id` (UUID-shaped, else false; no cast error) has an `auth.sessions` row of the caller whose `not_after` has not passed | 1 |
| `consume_invitation` | Same signature and 000071 binding; refuses `revoked_at IS NOT NULL` (P0001 `INVITATION_REVOKED`), so the invitations a removal revokes are dead now rather than in 05-07a | 1 |
| `features/staff/{schema,service,actions}.ts` | `removeStaffSchema` (uuid, reason 1–500, no control characters). Action `removeStaff({ membershipId, reason })`: `resolveServiceContext("staff:invite")` first, then the input, then `staffService.removeStaff(ctx, input)`: `remove_member` on the user client (only the membership id and reason are sent; no tenant, no actor), `mapDbError` with fixed texts (`REMOVE_STAFF_MESSAGES`; 42501 `OWNER_REQUIRED` gets its own text), the result shape validated. No system module (ADR-0005 D2): the session revocation is inside the RPC (R-43) | 2 |
| Active members only (Rule 2, see deviations) | `lib/auth/tenant.ts` `getActiveMembership` (`status = 'active'`, belt and braces with RLS); `lib/auth/tenant-refs.ts` `memberOfTenant` (booking, waitlist, consultation doctor references); `lib/api/doctor-guard.ts` (v1 visits, prescriptions, referrals); `features/visits/service.ts` `getActiveClinicDoctors`; `features/staff/service.ts` doctor directory and staff directory; `/staff` page members (and pending invitations exclude revoked ones). `getTenantDoctorMap` keeps removed doctors (`includeInactive`), so past records still show who saw the patient | 2 |
| Matrix | `tests/authz/table-matrix.ts`: principals `removed_a` (owner role, status `removed`, no header) and `suspended_a` (doctor role, status `suspended`, header A); `Principal.statuses` + `activeMemberships()`; the generator's `activeTenant`/`admits` use active memberships and the fixtures carry `status`/`removed_at`. Both principals are denied every tenant cell (only global catalogue reads remain); `table-matrix.spec.ts` pins that, and that the same principals with an active row would be admitted widely | 3 |

Shared artefacts in the same commit: `EXPECTED_MIGRATION` 000087; `scripts/drift/schema-snapshot.txt`;
`types/database.ts`; the regenerated `authz_matrix.test.sql` (3224 cells) and `AUTHZ-MATRIX.md`;
`definer_functions.test.sql` (`remove_member` bound with a dual-member leg pair, `session_is_live` exempt, grantees);
`lib/db/errors.ts` (`LAST_OWNER`, `MEMBER_NOT_ACTIVE`, `INVITATION_REVOKED` → CONFLICT, `SELF_REMOVAL` →
VALIDATION_FAILED) and `tests/db/error-map.spec.ts`; `tests/setup/teardown.ts` `NO_ACTION_USER_REFS` +
`memberships.removed_by`, `invitations.revoked_by` (the teardown catalogue spec pins the list); the guard manifest
(`removeStaff`: `staff:invite`), its valid inputs and a `LEG3_CONTROL_EXEMPT` entry; the pgTAP gate
(`remove_member` required, `FLOOR` 3934 → 4513).

## Tests that fail without the change

| File / spec | Cases | Without | With |
|---|---|---|---|
| `authz_matrix.test.sql` (regenerated) | 3224 (+496) | mutant "000086 helper bodies" (no status filter): **156 cells fail**, every one a removed/suspended principal admitted | 3224/3224 |
| `remove_member.test.sql` (new) | 81 | helper mutant: 15 fail (§5 status in helpers, §6 change_member_role, …); mutant "session delete without the fail-soft block": 4 fail (§4); mutant "no session delete": 7 fail (§3 sessions/refresh tokens/counts, §7) | 81/81 |
| `definer_functions.test.sql` | 36 (+2) | `remove_member` unclassified → the set_eq fails; dual leg | 36/36 |
| `tests/integration/auth/remove-member.spec.ts` (new, real GoTrue sessions) | 13 | against the helper + no-session-delete mutants: 3 fail (the 0-rows sweep finds leaks, `session_is_live`/refresh still alive, counts); with the app's status filters stripped: the removed-doctor case fails (still offered and assignable) | 13/13 |
| `tests/authz/table-matrix.spec.ts` | +2 | the generator without `activeMemberships` admits both principals | pass |
| `tests/db/error-map.spec.ts` | +6 | `SELF_REMOVAL` unregistered → CONFLICT instead of VALIDATION_FAILED | pass |
| `tests/setup/teardown.spec.ts` | (existing) | without the two new refs the catalogue list differs | pass |

`remove_member.test.sql`, by section:
1. **Catalogue:** the column, its default, both CHECKs; no API role may UPDATE `status`/`removed_at`/`removed_by` and a
   suspended member's own UPDATE is 42501; `revoked_*` readable, `token_hash` not; exact EXECUTE grants
   (`authenticated` only) and definer + `search_path ''` for both functions.
2. **Refusals** (each rolled back): anon; no JWT (`ACTOR_INVALID`); receptionist and doctor (`STAFF_REMOVE_FORBIDDEN`);
   admin removing an owner, another admin, or themself (`OWNER_REQUIRED`); the clinic's only owner (`LAST_OWNER`); an
   owner with a co-owner removing themself (`SELF_REMOVAL`); blank, control-character and 501-character reasons; an
   unknown id; an owner of A naming B's member; **a dual member acting in A naming B's member, where they are B's owner**
   (`MEMBER_NOT_FOUND`), and the same call acting in B succeeds.
3. **Effects** (admin of A removes a doctor who is also a doctor of B): exact return `{2 keys, 1 invitation, 2
   sessions}`; status/removed_at/removed_by; B membership untouched; row kept; the two live A keys revoked, an earlier
   revocation time kept, the B key and another member's key live; the A pending invitation revoked by the caller, a
   consumed one, the B one and another member's untouched; **every `auth.sessions` row and refresh token of the user
   gone, another user's kept**; one audit row with counts only and the trimmed reason; removing again
   `MEMBER_NOT_ACTIVE`; the doctor's visit intact.
4. **Fail-soft (R-43):** a BEFORE DELETE trigger on `auth.sessions` raises 42501 (local `postgres` cannot revoke its
   DELETE, granted by `supabase_auth_admin`; see deviations), all inside a rolled-back subtransaction: the removal
   succeeds with `sessions_revoked = null`, the membership is `removed`, the session is still there, the audit row says
   null; nothing is left behind.
5. **Status in the helpers (acceptance 4):** the removed nurse, JWT still valid: no active clinic (with or without the
   header), no member clinic, 0 patients/visits/memberships/tenants, no patient INSERT, `log_audit` `ACTOR_INVALID`,
   `issue_queue_token` forbidden, `has_permission` false, `my_tenant_access` nothing; a suspended member alike; a member
   removed in A and active in B falls back to B; control: an active doctor of A reads the patient.
6. `change_member_role` on a removed or suspended target or by a removed caller → `not_found`; a removed co-owner does
   not count for the last-owner guard (and `remove_member` refuses the remaining owner); `consume_invitation`: control,
   then `INVITATION_REVOKED` for a revoked invitation and for the one `remove_member` revoked.
7. `session_is_live`: true for the caller's session; false for the removed user's deleted session, another user's
   session id, an expired session, no claim and a malformed claim; anon cannot execute it.

`remove-member.spec.ts` (the acceptance path, real sessions): the owner removes an admin through `removeStaff`; before,
the admin reads patients, memberships, tenants, API keys and invitations; after, **the same supabase-js client (its
access token still accepted by PostgREST) reads 0 rows (or 42501) from every one of the 40 tenant tables of the
matrix**; `session_is_live()` is false and `refreshSession()` fails with `refresh_token_not_found`; their API key
answers 401 through `authenticateApiKey`; their pending invitation is revoked by the owner; one audit row with exactly
the allowed metadata keys; signing in again resolves "Your account is not linked to a clinic yet". A removed doctor
drops out of `memberOfTenant` and the doctor directory but stays in the name map. Refusals keep fixed texts
(receptionist, admin removing the owner, the sole owner, malformed id, blank reason, another clinic's id).

## Decisions and deviations

1. **Audit row written by the definer function, not through `log_audit`** (plan: "audit `staff.removed` through
   `log_audit`"). `log_audit` accepts only actions on its client allow-list (05-11b); adding `staff.removed` there would
   let any member write a forged removal row from the app. `remove_member` inserts the row itself, as
   `change_member_role` does (actor = `auth.uid()`, role = the caller's active role, tenant = the target's clinic, which
   is the active clinic). Same audit content as planned (counts only, plus target user, role and the reason).
2. **Fail-soft proof by a refusing trigger, not a REVOKE** (plan: "with DELETE on auth.sessions revoked from the function
   owner inside the test"). Locally `postgres` holds DELETE on `auth.sessions` as a grant from `supabase_auth_admin`
   and can neither revoke it nor `SET ROLE` to the grantor (both tried). A BEFORE DELETE trigger raising SQLSTATE
   42501 (`insufficient_privilege`, what a hosted refusal raises) exercises the same handler; trigger, function and
   lock are rolled back with the probe's subtransaction. The hosted privilege itself stays PO action 05-P4 (AUTH-00 kit
   item 4).
3. **Check order** makes every guard reachable: owner-only before last-owner, last-owner before self. "The last owner"
   is therefore the sole owner removing themself (`LAST_OWNER`); `SELF_REMOVAL` is an owner with a co-owner; an admin
   naming themself gets `OWNER_REQUIRED` (an admin target needs an owner).
4. **Rule 2, active members only in the app's doctor/staff lookups.** Not in the plan's file list. Without it a removed
   doctor stays bookable (`memberOfTenant` passes: the composite FK only proves the row exists) and listed in pickers
   and the staff page. The name map keeps removed doctors for past records. No DB guard refuses assigning a removed
   doctor to a new visit (an app-level check; see open items).
5. **`consume_invitation` refuses revoked invitations now** (05-07a replaces the function again): otherwise the
   invitations `remove_member` revokes would still redeem until 05-07a.
6. **Guard suite leg-3 control exempt for `removeStaff`.** The world's tenant-A membership is the caller's own (the RPC
   refuses self-removal) and removing anyone else would change later legs; the forged-id variants still run, and the
   success path is proven by the pgTAP file and the spec above.
7. A removed member keeps no access anywhere through status alone; `suspended` behaves identically and is reserved for
   V2-11/V2-13c (R-32). The auth user is never banned (other clinics keep them); removal signs them out of every clinic
   until they sign in again (recorded as intended in the plan).

## Local evidence (tool output, `evidence/05b/05-05/`)

| Check | Result | File |
|---|---|---|
| Mutant "000086 helper bodies" (no status filter) | matrix **156/3224 fail** (all removed/suspended cells), `remove_member` 15/81 fail; restored, `schema-snapshot --check` PASS | `mutant-helpers-no-status.sql`, `pgtap-mutant-helpers-no-status.tap`, `snapshot-check-after-mutants.txt` |
| Mutant "session delete without the fail-soft block" | `remove_member` 4/81 fail (§4) | `mutant-no-failsoft.sql`, `pgtap-mutant-no-failsoft.tap` |
| Mutant "no session delete" | `remove_member` 7/81 fail (§3, §7) | `mutant-no-session-delete.sql`, `pgtap-mutant-no-session-delete.tap` |
| `remove-member.spec.ts` against the helper + no-session-delete mutants | 3 of 13 fail (leaks in the 40-table sweep, session still live, counts) | `vitest-remove-member-db-mutants.txt`, `snapshot-check-after-spec-without.txt` |
| `remove-member.spec.ts` with the app's status filters stripped | the removed-doctor case fails | `vitest-remove-member-without-app-status-filters.txt` |
| pgTAP lane + gate (db 000087, tree `29358dc`) | 40 files, **4513/4513**; gate PASS (floor 4513, 40 required); `remove_member` 81, matrix 3224, `definer_functions` 36 | `pgtap-lane.tap`, `pgtap-report-gate.txt`, `pgtap-new-files.txt` |
| Full Vitest (tree `29358dc`) | **250 files, 4929/4929**, 0 failed, 0 skipped; gate PASS (floor 4633, 155 required); teardown removed 215 run tenants and verified none remain | `vitest-summary.json`, `vitest-report-gate.txt` |
| e2e PR lane, fresh `e2e:build` at `29358dc` | **222 passed, 9 skipped, 0 failed, 0 flaky, 0 retried** (desktop, Pixel 7, iPhone 15) | `playwright-summary.json`, `e2e-pr-tail.txt`, `e2e-build-tail.txt` |
| typecheck, `eslint . --quiet`, inventory, `db:drift:local`, `schema-snapshot --check`, `authz:gen --check`, migration immutability (base `b6ffb27`) | all exit 0 / PASS | `static-checks.txt` |

An earlier full Vitest run (before the commit) had 4 failures, root-caused and fixed before the final run: two
`hosted-dump-diff` cases failed in the shadow-database replay of `supabase/migrations/` during the minutes this
session had an unfinished 05-07a migration file there (its replay output is in the run log; with the file moved out the
spec passed on re-run and in the final run; a migration must not sit in that directory before its plan applies it), and two
`calendar-scheduling-ux` cases whose hand-built `memberships` mock accepted exactly two `.eq()` calls (the new
`status` filter is a third; the mock now accepts any chain). No test was retried.

**Shared stack.** `supabase db reset --local` ran once for 05-05 (2026-11-14T22:06:33Z, under the test-run lock) to
apply 000087, followed by `npm run seed:local` (no `--reset`). Three mutation runs replaced the helper bodies or
`remove_member` for a few seconds under the test-run lock and were restored from the migration text straight after;
the spec-against-mutants run held the lock with a nested lock for Vitest (05-09c pattern). `schema-snapshot --check`
passed after each.

## Threats

- **T-05-24 (removed staff keeps reading with a live JWT):** mitigated: status in every helper body; proven by 3224
  matrix cells, §5 and the real-session sweep of 40 tables.
- **T-05-25 (removed staff refreshes the session):** mitigated locally (sessions and refresh tokens deleted inside the
  RPC; `refreshSession()` fails); hosted privilege per 05-P4, fallback = the 900 s access token (fail-soft proven).
- **T-05-26 (last owner removed; admin removes the owner):** mitigated (owner-only, last active owner under the owners
  lock, no self-removal).
- **Elevation through a reactivation:** status/removed_* are not member-writable (column grants; pinned).
- **Spoofing the tenant or actor:** the RPC takes neither; the clinic is the row's and must be the active clinic (dual
  member leg).
- New SECURITY DEFINER surface: `remove_member` (bound, catalogued with a dual leg) and `session_is_live` (own session
  only, catalogued exempt).

## Open items

- **05-P4 (PO):** whether hosted `postgres` may delete `auth.sessions` (kit item 4); the code is fail-soft either way.
- **V2-11:** staff-removal UI, J-A6 (R-31); showing removed members (status) on the staff page if wanted.
- **Assignment of a removed doctor at the DB level:** the app checks active membership before booking/assigning; a DB
  guard (visits/waitlist/prescriptions doctor must be active on INSERT) is not in V2-05's plan — candidate for V2-08
  with the booking command.
- **05b gate:** add `tests/integration/auth/remove-member.spec.ts` to the Vitest gate's `REQUIRED_FILES`.
- 05-07a next: invitations v2 (reactivation of removed members, R-32).
