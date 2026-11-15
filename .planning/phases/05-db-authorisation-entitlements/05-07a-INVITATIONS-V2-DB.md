---
phase: 05
plan: 05-07a
part: 05b (wave 6)
subsystem: AUTH-06 invitations v2, database (invite/resend/revoke, send-time tokens, peek, address-bound redemption)
status: complete (local)
migrations: [000088_invitations_v2]
plan_head_before: 2cc4b8e
commits: [bb9de1d, docs commit]
code_head_after: bb9de1d
requirements: [AUTH-06 (backend), AUTH-D1, SEC-08]
acceptance: [10 (prerequisite: one job per invitation version, stale versions mint nothing; the exactly-one-email proof is 05-07b's)]
---

# 05-07a record: invitations v2 (database)

**Outcome:** done locally. One migration, `000088_invitations_v2`, built on 05-11b's H-INVITE binding (000071) without
weakening it and on 05-05's revocation columns:
- `invitations` gains `token_version`, `last_sent_at`, `send_count`; `token_hash` becomes nullable (minted at **send**
  time, R-30); one pending invitation per clinic and address (unique partial index); the INSERT policy is dropped and
  INSERT revoked from `anon`/`authenticated`;
- `invite_staff`, `resend_invitation`, `revoke_invitation` (members, bound to the active clinic), `invitation_issue_token`
  and `consume_invitation_for` (service role only, with the R-38 session-role rule), `peek_invitation` (anon), and
  `consume_invitation` reworked on one shared redemption path that reactivates a removed member (R-32);
- the send job (`email.invite`, payload `{invitation_id, token_version}`, key `invite:<id>:v<n>`) is enqueued in the
  same transaction as the invitation, through V2-04's `ops.enqueue_job`.

The app's `inviteStaff` now calls `invite_staff` (the direct INSERT it used is revoked). `invitations_v2.test.sql`
(75 cases) is new; four mutants each turn named cases red. pgTAP 41 files / 4592, full Vitest and the e2e PR lane green
with 0 retries (below). Nothing hosted was contacted; every Supabase CLI call used `--local`.

## What shipped

| Object | Contents | Plan step |
|---|---|---|
| `invitations` columns | `token_version int not null default 1` (CHECK ≥ 1), `last_sent_at`, `send_count int not null default 0` (CHECK ≥ 0); `token_hash` nullable (comment updated); SELECT granted on the three new columns (`token_hash` still unreadable). Pre-v2 duplicates of a pending address are revoked first (idempotent: the newest pending row per clinic and address is kept), then `invitations_one_pending_per_address` = UNIQUE `(tenant_id, lower(invited_address)) WHERE consumed_at IS NULL AND revoked_at IS NULL` | 1 |
| No direct INSERT | `DROP POLICY invitations_insert`; `REVOKE INSERT … FROM anon, authenticated` (the service role keeps it for seeds). Matrix: `invitations` INSERT → `rpc_only` (completeness pins the privilege) | 1 |
| `public.invite_staff(p_tenant, p_email, p_role) → jsonb` | Definer, `search_path ''`, `lock_timeout 5s`, `authenticated` only. Actor = `auth.uid()`. `p_tenant` (the server session's `ctx.tenantId`) must be in `authz.tenant_ids_with('staff:invite')` for an **active** membership of the caller, else 42501 `STAFF_INVITE_FORBIDDEN` (a dual member acting in A cannot name B; a removed admin cannot invite). Role in the five roles and a plain address ≤ 254 chars, else P0001 `INPUT_INVALID`; owner/admin invitations by an owner only (42501 `OWNER_REQUIRED`); an address that is already an active or suspended member of the clinic: P0001 `ALREADY_MEMBER`. An unexpired pending invitation for the address (any case) is returned with `deduped: true` and **nothing is enqueued**; an expired pending one is revoked (hash cleared) first. Inserts `token_hash NULL`, `expires_at = now() + 72 h`, the address lower-cased, `ON CONFLICT … DO NOTHING` (a concurrent winner is returned deduped), then `ops.enqueue_job('email.invite', p_tenant, {invitation_id, token_version}, 'invite:<id>:v<n>', now(), 5)` and an audit row `staff.invited` (role, version). Returns `{id, expires_at, deduped}`; never a token | 2 |
| `public.resend_invitation(id)`, `public.revoke_invitation(id)` | Definer, `authenticated`. The row (locked) must be in the caller's active clinic (else P0002 `INVITATION_NOT_FOUND`), the caller's active role there must hold `staff:invite` (42501 `STAFF_INVITE_FORBIDDEN`), an owner/admin invitation needs an owner (42501 `OWNER_REQUIRED`). Resend: pending only (P0001 `INVITATION_NOT_PENDING`), `token_version + 1`, `token_hash = NULL` (the old link is dead at once), a new 72 h expiry, a new job with the new key, audit `staff.invite_resent`. Revoke: not for a consumed one; `revoked_at/by`, `token_hash = NULL`, audit `staff.invite_revoked`; a second revoke returns the first revocation | 2 |
| `public.invitation_issue_token(id, version) → text` | Definer, **service_role only** + the session-role rule. Pending, unexpired and on `version` → 32 bytes from `extensions.gen_random_bytes`, hex; stores `encode(sha256(convert_to(raw,'UTF8')),'hex')` (= `hashInviteToken(raw)` in `features/staff/invite.ts`), `send_count + 1`, `last_sent_at`; returns the raw token once. Otherwise NULL (a stale or dead job sends nothing). Each call mints a new token, so a retried send after a transport failure invalidates the unsent one | 2 |
| `public.peek_invitation(hash) → jsonb` | Definer, `anon` + `authenticated`, STABLE. Malformed or unknown hash → `{"status": "not_found"}` only. Known → `{status, clinic_name, role, masked_email}` with status `pending`/`expired`/`revoked`/`used`; the mask is the first character of the local part + `***@` + domain. No address, ids or dates | 2 |
| `public.consume_invitation(hash)` / `public.consume_invitation_for(user, hash)` | Both call the internal `private.invitation_consume`: hash shape, row lock, used (the system path is idempotent for the same user and returns the clinic again), revoked (`INVITATION_REVOKED`), expired, then **the account's email must equal the invited address** (42501 `INVITATION_EMAIL_MISMATCH`, H-INVITE kept); the user path also needs it confirmed (`INVITATION_EMAIL_UNCONFIRMED`), the system path does not (05-07b confirms the address it validated). An existing membership: `removed` → the **same row** is reactivated with the invited role (R-32); active/suspended → P0001 `ALREADY_MEMBER`; else a new membership. Marks consumed, audit `staff.invite_accepted` (role, membership id, reactivated). The user path keeps the 000071 texts the app maps. `consume_invitation` is now `authenticated` only (was also `service_role`, which has no `auth.uid()`); `consume_invitation_for` is `service_role` only | 2 |
| Actor rule (R-38) | `private.invitation_system_caller()`: `coalesce(nullif(current_setting('role'), 'none'), session_user) IN ('service_role', 'postgres')`, never `current_user` (the owner inside a definer). Both service-role functions refuse any other caller with 42501 `SYSTEM_ONLY` even if a grant leaked (proven) | 2 |
| Internals | `private.invitation_inviter_role`, `invitation_manager_role`, `invitation_enqueue_send`, `invitation_consume` (invoker) and `private.invitation_audit` (definer, so no invoker function writes `audit_logs`, `audit_v2.test.sql`); all `search_path ''`, executable by no API role (pinned) | 2 |
| `features/staff/actions.ts` `inviteStaff` | Calls `invite_staff` with `p_tenant = session.tenantId`, the address and the role (no token, hash or link); fixed texts (`OWNER_REQUIRED`, `ALREADY_MEMBER`, input, fallback); the result shape validated. Resend/revoke actions, the email handler and `/join` are 05-07b's | Rule 3 (see deviations) |

Shared artefacts in the same commit: `EXPECTED_MIGRATION` 000088; `scripts/drift/schema-snapshot.txt`;
`types/database.ts`; the regenerated matrix (`invitations` INSERT `rpc_only`; 3224 cells), completeness and
`AUTHZ-MATRIX.md`; `table-matrix.spec.ts`; `definer_functions.test.sql` (`invite_staff`, `resend_invitation`,
`revoke_invitation` bound with dual-member legs; `peek_invitation` exempt (anon); `invitation_issue_token`,
`consume_invitation_for` system; `private.invitation_audit` internal; `consume_invitation` grantee narrowed);
`tests/api/readiness-probe-db.spec.ts` anon allowlist + `peek_invitation` (05-07a); `lib/db/errors.ts`
(`ALREADY_MEMBER`, `INVITATION_NOT_PENDING` → CONFLICT) + error-map cases; the pgTAP gate (`invitations_v2` required,
`FLOOR` 4513 → 4592).

## Tests that fail without the change

| File / spec | Cases | Without | With |
|---|---|---|---|
| `invitations_v2.test.sql` (new) | 75 | at 000087: aborts at the first statement on a new column, "planned 75 ran 0" | 75/75 |
| the same + `definer_functions`, `admin_policies`, `invitation_binding` under 4 mutants | | **inviter role from any membership** (no active-clinic binding, no staff:invite, no status): 7 cases (receptionist, removed admin, dual member A→B in three files, receptionist resend); **system-caller rule reading `current_user`** (SUB §8.1 verbatim pattern): the leaked-grant case (a JWT caller mints a token); **redemption without the address binding**: 4 cases (another confirmed account, the system path for another user, the two H-INVITE repros); **token minted for any version**: the stale v1 job case | pass |
| `definer_functions.test.sql` | 40 (+4) | at 000087: aborts (fixture invitation with a NULL hash) | 40/40 |
| `admin_policies.test.sql` (invitations through `invite_staff`) | 32 | at 000087: 7 fail (no RPC; the INSERT policy still listed) | 32/32 |
| `authz_matrix` / `authz_completeness` | 3224 / 6 | at 000087: owner and admin INSERT cells admitted (2), the INSERT grant still held (1) | pass |
| `invitation_binding.test.sql` | 14 | at 000087: the catalogue case (INSERT still granted) | 14/14 |
| `tests/auth/invite.spec.ts`, `tests/security/membership-guard.spec.ts` (TC-RLS-MEM-04) | rewritten | encoded the v1 direct INSERT; now: the RPC creates, no token stored, a direct INSERT is 42501 for the owner too; owner/admin rules and the receptionist refusal through the RPC | pass |
| `tests/security/invite-token-lockout.spec.ts` | 4 | the previous `inviteStaff` (direct insert of a hash) fails all four: no `invite_staff` call | pass |
| `tests/api/readiness-probe-db.spec.ts` | (existing) | without the allowlist entry, the anon-executable definer list differs | pass |
| `tests/db/error-map.spec.ts` | +4 | unregistered reasons map elsewhere | pass |

`invitations_v2.test.sql`, by section:
1. **Catalogue:** `token_hash` nullable; the three columns; the partial unique index; no INSERT/ALL policy; no INSERT
   privilege for anon/authenticated and **an owner's direct INSERT is 42501**; exact EXECUTE grantees of the seven RPCs;
   definer + `search_path ''`; the private helpers executable by no API role; `authenticated` cannot execute
   `invitation_issue_token` or `consume_invitation_for`; **with a leaked grant both still refuse a JWT caller
   (`SYSTEM_ONLY`)**.
2. **invite_staff:** the owner's invite (lower-cased, no hash, version 1, 72 h, `created_by` = caller); **exactly one
   job** with the payload and key above and no token; a duplicate (other case, other inviter) returns the same id with
   `deduped` and still one job; admin → admin/owner `OWNER_REQUIRED`; admin → nurse ok; owner → admin ok; receptionist,
   **removed admin**, **dual member acting in A naming B**, no clinic → `STAFF_INVITE_FORBIDDEN`; acting in B ok
   (control); malformed address and unknown role `INPUT_INVALID`; an existing member `ALREADY_MEMBER`; anon refused; an
   expired pending invitation is revoked (hash cleared) and replaced; **a failing statement after the RPC rolls back
   the invitation and its job together**.
3. **Send-time tokens:** the service role mints a 64-hex token once; only its SHA-256 is stored; the token is in no job
   payload; `peek` (anon) returns exactly status/clinic/role/masked address; resend → version 2, hash cleared, a second
   job keyed `:v2`; **`invitation_issue_token(id, 1)` → NULL**; the first link's peek is `not_found`; the v2 job mints
   the second link; resend refusals (admin on an admin invite, receptionist, another clinic's, a used one); revoke by
   the dual member acting in A on B's invitation not found; revoke sets the columns and clears the hash, a second revoke
   returns the same revocation, a revoked invitation mints nothing; peek unknown/malformed `not_found`; peek `expired`,
   `used`, `revoked` (hash kept by a 05-05 removal).
4. **Consume:** another confirmed account holding the link `INVITATION_EMAIL_MISMATCH`; expired; revoked; used; the
   resent-over link invalid; the invitee (address equal ignoring case) redeems the second link and is an active doctor;
   reuse refused; an unconfirmed invitee is refused on the user path and accepted on the system path, which is
   idempotent (one membership) and refuses a different user and another user's address; **a removed nurse re-invited as
   receptionist gets the same membership row back, active, with the new role** and the acceptance is audited
   (`reactivated: true`); an active member redeeming into her own clinic `ALREADY_MEMBER`; the invitation's audit trail
   is `invited`, `invite_resent`, `invite_accepted`.

## Decisions and deviations

1. **`inviteStaff` switched to `invite_staff` here (Rule 3; the plan lists `features/staff/actions.ts` under 05-07b).**
   The plan's own step 1 revokes INSERT from `authenticated`, which breaks the app's direct insert at once; switching
   the call in the same commit keeps every lane green and the deploy order trivial. 05-07b still owns the resend/revoke
   actions, the email handler, `/join` and the exactly-one-email proof.
2. **Audit rows for invite/resend/revoke/accept.** The plan names only `staff.invite_accepted`; the other three cost one
   row each and keep the invitation's life traceable. They are written by a definer helper with no API grant, so no
   member can forge them through `log_audit`.
3. **`ALREADY_MEMBER`** (invite and consume): an active or suspended member of the clinic is refused instead of
   failing on the unique membership key (23505); a `removed` one is reactivated (R-32). Suspension is a platform action
   (reserved, V2-11/V2-13c), so it is not undone by an invitation.
4. **A deduplicated invite keeps its role.** A second invite for a pending address returns the existing invitation
   whatever role was asked; to change the role the inviter revokes and invites again (V2-11 UI).
5. **Revocation clears the hash; a 05-05 removal does not.** `revoke_invitation` and `resend` clear `token_hash` (plan);
   `remove_member` (000087) only sets `revoked_*`, so `peek` can say `revoked` for those. Both are refused at redemption.
6. **Masked address:** first character of the local part, `***`, `@domain`. **`consume_invitation` lost its
   `service_role` grant** (it needs `auth.uid()`; the system path is `consume_invitation_for`).
7. **Pending `email.invite` jobs until 05-07b.** The runner claims only registered kinds, so the jobs wait (no send, no
   error); 05-07b registers the handler. 05-07a and 05-07b ship in the same 05b PR.

## Local evidence (tool output, `evidence/05b/05-07a/`)

| Check | Result | File |
|---|---|---|
| Changed pgTAP files against the 000087 database | `invitations_v2` and `definer_functions` abort (planned 75 / 40, ran 0); `admin_policies` 7, matrix 2, completeness 1, `invitation_binding` 1 fail | `pgtap-changed-files-without-000088.tap`, `without-000088-db-version.txt` |
| Mutant: inviter role from any membership | 7 cases fail across `invitations_v2`, `definer_functions`, `admin_policies` | `mutant-inviter-any-membership.sql`, `pgtap-mutant-inviter-any-membership.tap` |
| Mutant: system-caller rule reading `current_user` | the leaked-grant case fails (a JWT caller would mint a token and redeem for another user) | `mutant-system-caller-current-user.sql`, `pgtap-mutant-system-caller-current-user.tap` |
| Mutant: redemption without the address binding | 4 cases fail (`invitations_v2` 2, `invitation_binding` 2) | `mutant-consume-no-email-binding.sql`, `pgtap-mutant-consume-no-email-binding.tap` |
| Mutant: token minted for any version | the stale-v1 case fails | `mutant-issue-any-version.sql`, `pgtap-mutant-issue-any-version.tap` |
| Restore after the mutants | `schema-snapshot --check` PASS | `snapshot-check-after-mutants.txt` |
| `invite-token-lockout.spec.ts` with the previous `inviteStaff` | 4 of 4 fail | `vitest-lockout-with-previous-inviteStaff.txt` |
| First pgTAP run at 000088 | 2 of 75 failed on a fixture bug (the "expired" fixture shared the invitee's address, so `invite_staff` correctly revoked it first); the fixture address was changed, the product unchanged | `pgtap-first-run-fixture-collision.txt` |
| pgTAP lane + gate (db 000088, tree `bb9de1d`) | 41 files, **4592/4592**; gate PASS (floor 4592, 41 required) | `pgtap-lane.tap`, `pgtap-report-gate.txt`, `pgtap-new-files.txt` |
| Full Vitest (tree `bb9de1d`) | **250 files, 4933/4933**, 0 failed, 0 skipped; gate PASS (floor 4633, 155 required); teardown verified no run data remains | `vitest-summary.json`, `vitest-report-gate.txt` |
| e2e PR lane, fresh `e2e:build` at `bb9de1d` | **222 passed, 9 skipped, 0 failed, 0 flaky, 0 retried** | `playwright-summary.json`, `e2e-pr-tail.txt`, `e2e-build-tail.txt` |
| typecheck, `eslint . --quiet`, inventory, `db:drift:local`, `schema-snapshot --check`, `authz:gen --check`, migration immutability (base `2cc4b8e`) | all exit 0 / PASS | `static-checks.txt` |

The targeted run before the commit found one ordering mistake of this plan (the anon allowlist entry was not in sorted
order; the spec compares a sorted list); fixed before the final run.

**Shared stack.** `supabase db reset --local` ran once for 05-07a (2026-11-14T22:40:46Z, under the test-run lock) to
apply 000088, followed by `npm run seed:local` (no `--reset`). Before it, the changed pgTAP files ran once against the
000087 database (the "without" run). Four mutation runs replaced one function each for a few seconds under the
test-run lock and were restored from the migration text straight after; `schema-snapshot --check` passed afterwards.

## Threats

- **T-05-27 (an invite link used by someone else):** mitigated: redemption on both paths requires the invited address
  (mutant proven); the user path also a confirmed one.
- **T-05-28 (raw token at rest):** mitigated: no token exists until the service-role handler mints it at send time;
  only its SHA-256 is stored; job payloads carry the invitation id and version only (asserted).
- **T-05-30 (duplicate emails under retry):** database part mitigated: one pending invitation per address, dedupe with
  no new job, one job per version (`ON CONFLICT` on the key), stale versions mint nothing. The send-side proof
  (acceptance 10) is 05-07b's.
- **Elevation through invitations:** owner/admin invitations stay owner-only; inviting is bound to the active clinic and
  an active membership with `staff:invite`; no member writes `invitations` directly any more.
- **Service-role functions reachable by a JWT:** grants plus the session-role rule (R-38), proven with a leaked grant.
- New anon surface: `peek_invitation` only (allowlisted, returns no address or ids).

## Open items

- **05-07b:** the `email.invite` handler (`invitation_issue_token`), resend/revoke actions, `/join` with
  `peek_invitation`, `consume_invitation_for` through the A4 importer, Turnstile, and the exactly-one-email proof.
- **V2-11:** invitation management UI (resend, revoke, role change by revoke + invite).
- **05b gate:** add `invitations_v2`-related Vitest specs (none new here) and review the R-38 erratum wording, now
  applied in two places (000085, 000088).
