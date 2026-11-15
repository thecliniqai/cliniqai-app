---
phase: 05
plan: 05-10a
part: 05b (wave 8)
subsystem: SUB-02 enforcement core (RLS helper bodies, definer and token functions, job claim, app guards, signed-URL caps, /api/v1 402, public pages)
status: complete (local)
migrations: [000090_access_enforcement]
plan_head_before: 6037598
commits: [5fbf707, docs commit]
code_head_after: 5fbf707
requirements: [SUB-02 (enforcement core), SUB §6.2/§7.2, R-14, R-27, R-28, R-29, R-40, SUB-D6]
acceptance: [8 (RLS and storage half; the function half was 05-09a), 11 (every suite green after the flip with trialing/comped tenants)]
---

# 05-10a record: SUB-02 enforcement core

**Outcome:** done locally. From migration `000090_access_enforcement` on, the database stops a clinic whose access
level is not `full`. The app does the same, with a typed refusal.
- **Locked or onboarding clinic, RLS and storage:** every role reads only `tenants` and its own `memberships`
  rows. The owner and admin also read the subscription and its events. No storage object is readable and no
  upload is allowed, on every public table with a `tenant_id` in the live catalogue (acceptance 8, RLS/storage
  half).
- **Definer RPCs** refuse a locked clinic.
- **Anon token paths:** share and reschedule links answer `clinic_unavailable` (SUB-D6: an expired clinic's
  prescription link shows metadata only).
- **Jobs:** the job claim cancels the jobs of non-full clinics (R-27).
- **App:**
  - server actions answer `SUBSCRIPTION_LOCKED`;
  - `/api/v1` answers 402;
  - signed URLs live 300 s (exports 900 s);
  - `requireEntitlement` exists for V2-12.

Every lane is green after the flip with the seeded `trialing`/comped clinics (acceptance 11): pgTAP 43 files / 7388,
Vitest 255 files / 5008, e2e PR lane 228 passed, 0 retries. Nothing hosted was contacted.

## What shipped

| Area | Contents | Plan step |
|---|---|---|
| `authz.full_tenant_ids()` (body) | 05-09c's flip body (+ 05-05's `status = 'active'`): the active clinic only while `billing_internal.tenant_access_level(m.tenant_id, now()) = 'full'`. `tenant_ids_with`, `has_permission`, every tenant-bound policy and every storage class read it, so no policy changed (R-14) | 1 |
| `authz.billing_tenant_ids()` (body) | owner/admin of the active clinic while its level is `full`, `locked` or `onboarding` (Pitfall 7: a locked owner still reads the subscription); `member_tenant_ids` / `active_tenant_id` unchanged | 1 |
| Definer functions bound through `authz.active_tenant_id()` directly | The one occurrence in each body is replaced with `(SELECT authz.full_tenant_ids() LIMIT 1)`, the FULL active clinic, in 11 functions: `change_member_role`, `create_share_token`, `revoke_share_token`, `enqueue_message`, `enqueue_webhook_event`, `record_payment` (user path), `remove_member`, `private.invitation_manager_role` (resend/revoke), `private.outbox_payment_recorded`, `communication_queue_claim`/`finish` (session branch). A locked clinic reads as "not found", like another clinic. The rest inherit the stop through `tenant_ids_with`/`has_permission`/`full_tenant_ids`: `invite_staff`, `issue_queue_token`, `generate_tenant_invoice_number`, `search_medicines`, `referral_source_clinics`, `referral_directory_search`. Level-neutral (no tenant data, or the caller's own level, entitlements or audit row): `log_audit`, `my_tenant_access`, `my_entitlements`, `current_user_tenant_ids` | 2 |
| Anon token functions | `resolve_share_token`: the level decides before anything of the resource is read. Not `full` → `{"status":"clinic_unavailable"}`, except a prescription of an `expired` clinic (SUB-D6), which resolves to metadata only (`restricted: true`, no file, no access count); nothing from `archived` on. Every live answer carries `access`. `get_reschedule_context` / `consume_reschedule_token`: `clinic_unavailable` before anything else. `share_token_object` (service role): NULL unless `full` | 2 |
| `claim_jobs` (R-27) | Before claiming, cancels the due jobs of the requested kinds whose clinic is not `full` (`cancelled`, `last_error = 'tenant_not_full'`, `finished_at`, lease cleared; `FOR UPDATE SKIP LOCKED`), except a closed exempt set (empty; V2-13b adds owner billing notices). Tenant-less jobs untouched. Same signature and grants | 3 |
| `lib/auth/tenant.ts` | `TenantAccessLevel`, `TenantLockedError` (`code: "SUBSCRIPTION_LOCKED"`, fixed text), `assertTenantAccess(membership, "full" \| "billing")` and `getTenantAccessLevel` (through `my_tenant_access`, fail closed) | 4 |
| `lib/permissions/guards.ts`, `lib/auth/context.ts` | `requirePermission(…, access = "full")` and `requireServiceContext` / `resolveServiceContext(…, access)` call `assertTenantAccess` **after** the membership and the role check (a refused role never reaches the lookup: the guard suite's "no data access before the refusal"); `resolveServiceContext` maps it to `reason: "locked"` with the fixed text; `clientErrorMessage` passes the text through. `getSubscriptionOverview` uses `access: "billing"` (a locked owner still sees the subscription) | 4 |
| `lib/errors/app-error.ts`, `lib/db/errors.ts`, `lib/api/envelope.ts` | `APP_ERROR_CODES` + `SUBSCRIPTION_LOCKED` ("Your clinic's subscription is not active. The clinic owner can renew it from Billing."); `RPC_REASON_CODES.SUBSCRIPTION_LOCKED`; `/api/v1` envelope maps it to 402 | 4 |
| `lib/entitlements/require-entitlement.ts` | `requireEntitlement(key)` / `activeEntitlements()` through `my_entitlements` (the caller's own clinic; full access first; fail closed). No caller yet (V2-12) | 4 |
| `lib/storage` (R-29) | `purpose: "view" \| "export"`, `SIGNED_URL_MAX_TTL_SECONDS = { view: 300, export: 900 }`, `clampSignedUrlTtl`, applied in `getSignedUrl` AND in `SupabaseStorageProvider.createSignedUrl` (a direct provider call cannot sign longer). Call sites lowered to 300 s: labs, referral letter (service + generator), prescription PDF, receipt PDF, share views (600 → 300) | 4 |
| `features/sharing/system.ts` (R-28) | Before signing or rendering a share object: `tenant_access_for_system(tenant) = 'full'` (second check next to `share_token_object`'s) | 4 |
| Public pages | `app/r/[token]`: `clinic_unavailable` → neutral page "This clinic's online services are unavailable."; a restricted (SUB-D6) prescription shows its metadata and that text, no viewer and no download. `app/reports/view`: neutral page. `/api/reschedule/[token]` GET/POST: 409 with the neutral text. `/api/r` and `/api/reports/view` answer 404 (nothing to sign) | 4 |
| `lib/api/auth.ts` (R-28) | After the key is authenticated and before anything is counted or read: `tenant_access_for_system(key.tenant_id)`; not `full` (or a lookup error) → 402 `SUBSCRIPTION_LOCKED` | 4 |
| `scripts/db/explain-rls.mjs` (loopback only) | `EXPLAIN (ANALYZE, BUFFERS, VERBOSE)` of the patient list and the visit list as a demo-clinic doctor, with 30 synthetic patients and visits added inside the rolled-back transaction. Asserts the helper sits in a SubPlan/InitPlan evaluated with `loops=1`. Result: PASS for both (hashed SubPlan, `ProjectSet loops=1`), `evidence/05b/explain-rls.txt` | 5 |
| Matrix (`tests/authz/table-matrix.ts`, `scripts/gen-authz-pgtap.ts`) | `Principal.access` + `accessSql`. 11 principals: every A role locked, every A role onboarding, and the dual member acting in a locked A. Each cell sets the level as `postgres` in its own rolled-back subtransaction (`pg_temp.authz_cell_at`). The generator's `full`/`perm` rules require level `full`; `billing` admits locked/onboarding. 5952 cells (+2728). New generated file `access_lock_rls.test.sql` | tests |

## Tests that fail without the change

| File / spec | Cases | Without (evidence) | With |
|---|---|---|---|
| `access_lock_rls.test.sql` (generated; acceptance 8 RLS/storage half) | 26 | with the pre-05-10a `full_tenant_ids` (any level): 20 fail (every locked/onboarding view and upload); with `billing_tenant_ids` full-only: the 4 owner/admin locked/onboarding views fail | 26/26 |
| `authz_matrix.test.sql` | 5952 | pre-05-10a helper: 642 fail; billing full-only: 8 fail | 5952/5952 |
| `definer_functions.test.sql` | 65 (+25) | pre-05-10a helper: 17 of the new legs fail; `resolve_share_token` without the access check: the receipt leg fails; `share_token_object` without it: the service-role leg fails | 65/65 |
| `tests/subscriptions/lock-enforcement.spec.ts` (new) | 10 | `requirePermission` without the access check / `requireServiceContext` without it: the server-action case fails (each); `/api/v1` without the 402: fails; no TTL clamp: fails; `claim_jobs` without the cancellation: the claim case fails; `resolve_share_token` without the check: 2 SUB-D6 cases fail; billing helper full-only: the locked owner's overview fails | 10/10 |
| `tests/authz/table-matrix.spec.ts` | +1, 1 changed | the subscription readers now include the locked/onboarding owner/admin; a new case pins that a locked/onboarding principal is admitted to nothing but `tenants`, the subscription and its events (catalogue excluded) | pass |
| `tests/storage/storage-provider.spec.ts` (changed), `tests/security/share-path-encoding.spec.ts` (+1) | | the provider spec encoded a 3600 s pass-through (now 300); the share spec's fake system client answers `tenant_access_for_system`, and a non-full clinic is not signed | pass |

**Defence in depth, shown by the mutants.** Two database mutants pass the Vitest spec because the app's own check
still refuses:
- `full_tenant_ids` at any level: `assertTenantAccess` still refuses in the app;
- `share_token_object` without its check: `clinicIsFull` still refuses in the sharing module.

The other way round, the app mutants are caught by Vitest while the database still refuses. Each layer has its own
failing test.

## Decisions and deviations

1. **The access check runs after the role check.** The first full Vitest probe (67 failures,
   `vitest-first-probe-before-fixes.json`) found that resolving the level inside `getActiveMembership` was a data
   access (`rpc:my_tenant_access`) before a refusal, in guard legs 2 and 4 of every action and session route.
   `assertTenantAccess` is now async and called after `assertPerm`, which matches the plan's order ("after resolving
   the membership"). The other 5 probe failures were tests encoding the old behaviour, fixed in the specs:
   - the 3600 s pass-through;
   - the share mock without `tenant_access_for_system`;
   - the subscription readers list.
2. **Definer functions: one substitution, not ten hand-written checks.** `authz.active_tenant_id()` → `(SELECT
   authz.full_tenant_ids() LIMIT 1)` in each body, taken from the live definition, so each function keeps its own
   not-found refusal. No new `SUBSCRIPTION_LOCKED` raise in SQL: the app answers that text before the RPC, and the
   database answer stays indistinguishable from "another clinic". Bodies changed through `CREATE OR REPLACE`, so the
   grants are unchanged (pinned by `definer_functions`).
3. **`log_audit` stays level-neutral.** It reads no tenant data and writes one audit row for the caller's active
   clinic; billing actions (V2-13b) may audit while locked. `my_tenant_access` / `my_entitlements` are member wrappers
   by design (05-09a).
4. **`access_lock_rls.test.sql` is generated** from the matrix fixtures, which hold one row in every table, so the
   sweep is not vacuous. It counts visible tenant-A rows per public table with a `tenant_id` from the **live
   catalogue**, so a new table is covered without editing the file; the expected strings come from the matrix rules
   (full controls included). A guard in the generator refuses to emit a locked/onboarding expectation other than
   "tenants + memberships (+ subscription, events for owner/admin) | storage 0".
5. **Memberships of a locked clinic:** a locked staff member sees only their OWN membership row (member helper); the
   clinic's other memberships come through `staff:view` (full). The plan says "staff read only tenants/memberships";
   own rows are what the switcher and the 05-10b redirects need.
6. **Onboarding (`incomplete`) is treated as locked** for every tenant table, as the plan requires. Production clinics
   created by `create_clinic_with_owner` stay `incomplete` until 05-10b's `/onboarding/billing` page and V2-13b.
7. **Cancelled `message.send` jobs leave their `communication_queue` row queued** (no patient message, none sent later).
   Showing them as cancelled in the clinic's message log is for V2-13b/V2-08 to decide.
8. **Signed URLs:** every current call site is a view (300 s); no call site signs an export yet (`purpose: "export"`
   exists for V2-13b's data export).

## Local evidence (tool output, `evidence/05b/05-10a/`, plus `evidence/05b/explain-rls.txt`)

| Check | Result | File |
|---|---|---|
| pgTAP lane + gate (db 000090, tree `5fbf707`) | 43 files, **7388/7388**; gate PASS (floor 7388, 43 required) | `pgtap-lane.tap`, `pgtap-report-gate.txt` |
| Full Vitest (tree `5fbf707`) | **255 files, 5008/5008**, 0 failed, 0 skipped; gate PASS (floor 4633, 161 required) | `vitest-summary.json`, `vitest-report-gate.txt` |
| e2e PR lane, fresh `e2e:build` at `5fbf707` | **228 passed, 9 skipped, 0 failed, 0 flaky, 0 retried** | `playwright-summary.json`, `e2e-pr-tail.txt`, `e2e-build-tail.txt` |
| First Vitest probe before the guard-order fix | 4939/5006 (67 failed: 64 guard-suite legs, 3 specs encoding old behaviour) | `vitest-first-probe-before-fixes.json` |
| Mutants (5 database, 4 app) | each fails named cases (tables above) | `mutants-summary.txt`, `mutant-*.sql`, `pgtap-mutant-*.tap`, `vitest-mutant-*.txt`, `vitest-app-mutants.py` |
| Restore after the mutants | `schema-snapshot --check` PASS | `snapshot-check-after-mutants.txt` |
| explain-rls (SUB §7.2) | patient list and visit list: helper in a hashed SubPlan, `loops=1`; PASS | `../explain-rls.txt` |
| typecheck, `eslint --quiet`, inventory, `db:drift:local`, `schema-snapshot --check`, `authz:gen --check`, migration immutability (base `6037598`), `env-example --check`, explain-rls | all exit 0 / PASS | `static-checks.txt` |

**Shared stack.**
- One `supabase db reset --local` for 05-10a (2026-11-14T23:43:48Z, under the test-run lock), to apply 000090,
  followed by `npm run seed:local` (no `--reset`; `access summary: full=1 locked=0 onboarding=0`).
- Mutant run under the test-run lock (with the nested Vitest lock, the 05-09c pattern), 2026-11-15T00:10Z onward.
  Five function bodies were replaced and restored from 000090's text; four app mutants changed source files and
  restored them by copy. `schema-snapshot --check` passed afterwards; `git status` was clean.

## Threats

- **T-05-31 (a locked clinic keeps reading patient data):** mitigated at every layer:
  - RLS and storage (helper body; `access_lock_rls`, matrix);
  - definer RPCs (legs) and anon token paths (`clinic_unavailable`);
  - service-role share paths (two checks);
  - `/api/v1` (402), with signed URLs capped at 300 s so an already-issued URL dies within minutes.
- **T-05-32 (patient messages from a locked clinic, or late after renewal):** mitigated. The claim cancels them
  (R-27), and `enqueue_message` refuses a locked clinic.
- **T-05-33 (the lock blocks the owner from paying or exporting):** mitigated:
  - `billing_tenant_ids` and `my_tenant_access` stay readable;
  - the billing overview uses `access: "billing"`;
  - `tenants` and the caller's own memberships stay readable (05-10b builds the pages).
- **T-05-34 (helper cost):** the helper is evaluated once per statement (explain-rls).
- New surface: none. Error texts are fixed; `clinic_unavailable` reveals only that the token exists and the clinic is
  not active, the same as `revoked`/`expired` already do.

## Open items

- **05-10b:** layout redirects (`/billing/locked`, `/billing/locked/staff`, `/onboarding/billing`), functional locked
  pages, the e2e locked-user leg, PWA §9.1 spec 1.
- **05-10c:** AI gating (`ai_preflight`/`ai_reserve`) on top of `requireEntitlement` and the access level.
- **V2-13b:**
  - the exempt kinds of the claim (owner billing notices);
  - export signing with `purpose: "export"`;
  - share-token revocation at `expired` (SUB §11);
  - a cancelled-message status in the message log.
- **05b gate:** re-measure the Vitest floor (95 % rule) with the arithmetic; PO action 05-P3 reads the staging
  `access summary` line.
