---
phase: 05
plan: 05-01b
subsystem: database authorisation (authz helpers, active tenant, permission set, matrix)
status: complete
requirements: [P1-01, ADR-006/C19, P0-14 (matrix part), PO-3, V2-03 03-07 D1 finding 2 (helper + carrier + principal)]
plan_head_before: a529ce1893d11d89f2e4ca1aae081a747981aa25
commits: [4077b37, f3c6b80, f87fe5f]
---

# 05-01b record: `authz` helpers, active-tenant carrier, PO-3 permission set, parity, generated matrix

**Outcome:** done locally. Migration `000046_authz_core.sql` adds the non-exposed `authz` schema with the
fixed-signature helpers of the shared contract, `public.has_permission` and `public.permission_matrix`, and repoints
`public.current_user_tenant_ids()` to `authz.member_tenant_ids()` (same meaning: no existing policy or RPC changes).
`lib/supabase/server.ts` `createClient()` carries the active clinic as `x-clinicos-tenant`; the tracer proves the
header reaches SQL through **PostgREST, RPC and Storage**, so the JWT-claim fallback of R-42 was not needed. The PO-3
key set is live in `lib/permissions/matrix.ts` and the SQL CASE (parity-tested). `tests/authz/table-matrix.ts` is the
single source; `npm run authz:gen` generates 2200 pgTAP cells, the catalogue completeness test and `AUTHZ-MATRIX.md`.
Nothing hosted was contacted; every Supabase CLI call used `--local`; resets ran under the test-run lock.

## What shipped

| Commit | Content |
|---|---|
| `4077b37` | `000046_authz_core.sql` (helpers, grants, `share_type_roles('invoice')` + `receipt_issued.request_roles` gain receptionist); `EXPECTED_MIGRATION = "000046"`; `SNAPSHOT_SCHEMAS` + `authz` and regenerated snapshot; `types/database.ts`; `lib/permissions/matrix.ts` (`PERMISSION_KEYS`, PO-3 set); `lib/supabase/server.ts` (carrier); `features/billing/subscription.ts` (`clinic:manage`) + guard-manifest row; `features/billing/service.ts` (consolidated share refuses an invoice id not in the active clinic); specs: `tests/authz/active-tenant-carrier.spec.ts`, `tests/permissions/has-permission-parity.spec.ts`, `tests/helpers/active-tenant.ts`, `supabase/tests/database/authz_helpers.test.sql` (77), `rbac`, `schema-snapshot` (authz drift case), `enqueue-message-rpc-db`, `p0-01-forged-overrides` |
| `f3c6b80` | `tests/authz/table-matrix.ts`, `scripts/gen-authz-pgtap.ts`, generated `authz_matrix.test.sql` (2200) + `authz_completeness.test.sql` (4) + `AUTHZ-MATRIX.md`, `tests/authz/{table-matrix,generator-drift}.spec.ts`; restore drill runs the matrix (`ops/restore-drill/drill-lib.sh` `drill_authz_matrix`, `tests/ops/drill-lib-db.spec.ts`; V2-04 R-11) |
| `f87fe5f` | `tests/e2e/m0/register-patient.spec.ts`: F-01 `knownBug` removed (receptionist registration is a plain test) |
| docs commit | this record, wave notes, evidence |

## Helper semantics (as built)

- `authz.active_tenant_id()`: the header's clinic when the caller is a member there; else the caller's ONLY
  membership (also when the header names a clinic they are not in, matching `getActiveMembership`, so a stale cookie
  cannot blank a single-clinic user); else null. Malformed header / non-JSON `request.headers` → no error.
- `full_tenant_ids` / `tenant_ids_with(perm)` / `billing_tenant_ids` / `has_permission`: at most the active tenant.
- `member_tenant_ids` (and the `current_user_tenant_ids` shim): every membership (switcher; legacy policies).

## Deviations (all documented in the migration or specs)

1. **[Rule 2] Owner is `true` for every known key only** (plan: "owner `true`"): a misspelt key in a policy denies
   everyone instead of silently admitting owners. Parity unaffected (owner holds all 20 keys).
2. **[Rule 3] `service_role` USAGE on `authz`** + EXECUTE on the two static functions (plan: usage to authenticated
   only), so the invoker `permission_matrix()` (granted to service_role by the plan) works. No session helper is
   granted to it.
3. **No `alter default privileges in schema authz revoke execute ... from public`**: proven a no-op
   (`default-privileges-probe.txt`); instead `authz_helpers.test.sql` pins the exact ACL of every `authz` function.
4. **[Rule 1] PO-3 knock-ons in SQL:** `share_type_roles('invoice')` and `ops.message_templates.receipt_issued` gain
   `receptionist` (the app already allowed the receipt share via `billing:view`; SQL would have refused it).
5. **[Rule 1] `sendConsolidatedConsultationWhatsApp`** passed a caller-supplied `invoiceId` not found in the active
   clinic straight to `create_share_token`; once receptionists hold `billing:view`, a dual member acting in A minted a
   link to B's receipt (guard leg 3b). The service now refuses it; the SQL binding of `create_share_token` is 05-02c's.
6. **Matrix cells target tenant-A rows only** (no B fixture rows): "dual member, header B" on an A row is the
   cross-tenant leg. `legacyCastError` encodes the current `clinic-records` C9 cast (22P02 for a non-member) until 05-02c.
7. `features/billing/service.ts`, `tests/security/guard-manifest.ts`, `ops/restore-drill/drill-lib.sh` and five
   existing specs were touched outside the plan's file list because the key change requires them.
8. Branding storage class: no key builder exists; not in the matrix (05-02c adds it with its builder).

## Evidence (tool output, `evidence/05a/05-01b/`)

| File | What it shows |
|---|---|
| `tracer-without-header.txt` | tracer with `createClient()` sending no header: (a) PostgREST and (b) Storage legs fail |
| `parity-one-key-edit.txt`, `parity-one-key-edit-sql.txt` | parity spec fails after a one-key edit in TS, and in SQL (both reverted; SQL body md5 restored) |
| `completeness-missing-table.txt` | first generator run lacked `public.invitations`: completeness `set_eq` failed naming it |
| `generator-drift-edited.txt` | a hand-edited `authz_matrix.test.sql` fails the drift spec |
| `default-privileges-probe.txt` | per-schema default-privilege REVOKE leaves PUBLIC EXECUTE on a new function |
| `guard-leg3b-consolidated-share-without-fix.txt` | leg 3b fails (B's share tokens and audit rows change) without the service fix |
| `pgtap-lane.txt`, `vitest-full.txt`, `e2e-pr.txt` | final lanes at the committed state |

## Tests that fail without the change

- `active-tenant-carrier.spec.ts` (7, real JWTs, PostgREST + Storage): legs (a)/(b) fail without the header.
- `has-permission-parity.spec.ts` (8): no `permission_matrix()` before; one-key edits fail.
- `authz_helpers.test.sql` (77): functions absent before; dual member A/B/none, malformed header, sole-membership
  fallback, exact ACLs, anon refused.
- `authz_matrix.test.sql` (2200) and `authz_completeness.test.sql` (4); `generator-drift.spec.ts`, `table-matrix.spec.ts`.
- `rbac.spec.ts` receptionist `patients:edit` / `billing:collect`; M0 receptionist registration (F-01) as a plain test.

## Lanes (final, tool output in evidence)

- `npm run typecheck` clean; `npx eslint .` 0 errors; `npm run inventory` 0 flagged; `npm run db:drift:local` PASS;
  `npm run authz:gen -- --check` clean (`npx tsx scripts/gen-authz-pgtap.ts --check`).
- pgTAP lane: 5 files, 2294 tests, PASS; report gate PASS (`pgtap-lane.txt`).
- Full Vitest: 4445 tests, 4445 passed, 0 failed, 0 skipped (`vitest-full.txt`).
- E2E PR lane (desktop-chrome, Pixel 7, iPhone 15): 196 passed, 9 skipped (pre-existing project-scoped skips),
  0 retried (`e2e-pr.txt`).

## Self-Check: PASSED
