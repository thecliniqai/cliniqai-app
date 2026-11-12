# 03-02 record: single system DB factory (P1-34, ADR-0005 D2/V4, C50 b/c/e, R15, T-03-01, T-03-18)

**Outcome:** done locally. The ESLint proof ("ESLint finds 1 service-role factory", bypass fixtures) is 03-04, as the
plan's acceptance mapping says.
**Commits:** `9184dfd` (migration 000026 `referral_source_clinics`, types, referrals service, DB spec), `f37f917`
(`lib/supabase/system.ts`, importers moved, `lib/supabase/admin.ts` deleted, storage fallback deleted, specs).
**Evidence:** `evidence/03-02/` (all tool output): `static-checks.txt` (typecheck, lint 0 errors, inventory, AI-L1,
migration immutability, types freshness, local drift, Vitest report gate, all from a clean worktree of `f37f917`;
Playwright summary from the main checkout at `4ab5643`), `vitest-full.json` (117 files, 2095 passed, 0 failed,
0 skipped), `playwright-pr.json` (128 passed, 0 retried, 10 expected KNOWN-BUG failures, same set as 03-01),
`service-role-census.txt`, `negative-*.txt`.

## What shipped

- `lib/supabase/system.ts` (`server-only`): `getSystemDb(reason: SystemDbReason)`. `SystemDbReason` is the closed set
  of current call sites, each mapped to its owning module in `REASON_OWNER`:
  `api_v1` → `app/api/v1`; `cron.dispatch_communications`, `cron.webhooks` → the two cron routes;
  `webhook.messaging_inbound` → `app/api/webhooks/messaging`; `share.sign`, `share.receipt_pdf`,
  `share.reschedule_notify` → `features/sharing/system`. A reason outside the set (cast, `any`, `__proto__`) throws
  before a client exists. Key from `serverEnv().SUPABASE_SECRET_KEY` (missing → throws, naming the key only), URL
  from `publicEnv`, `persistSession: false`, `autoRefreshToken: false`; the client is memoised per URL/key. Every
  call writes one line `{ ts, level: "info", event: "db.system_acquired", reason, module }` through `lib/log`.
- Importers: `app/api/v1/**` (14 files; one acquisition per handler, shared by the API-key lookup and the handler's
  queries), `app/api/cron/{dispatch-communications,webhooks}`, `app/api/webhooks/messaging/[provider]`,
  `features/sharing/system.ts` (one acquisition per exported step, passed down to the token RPC, the storage signer
  and the receipt compiler). Amendment A1's five importers of `features/sharing/system.ts` are unchanged.
- `lib/supabase/admin.ts` deleted. `lib/storage/supabase-provider.ts`: when the cookie client cannot be created it
  throws; it no longer imports `@supabase/supabase-js` values, `serverEnv` or `publicEnv`.
- Migration `000026_referral_source_clinics.sql`: `public.referral_source_clinics(p_ids uuid[]) returns table(id,
  name, phone)`, `SECURITY DEFINER`, `search_path = ''`, `STABLE`; a tenant is returned only if it is in `p_ids` and
  sent a referral whose `target_tenant_id` is in `public.current_user_tenant_ids()` (the condition of the
  `referrals_target_tenant_select` policy, 000013). EXECUTE revoked from `PUBLIC, anon, authenticated, service_role`,
  granted to `authenticated`. `getInboundReferrals` calls it through the caller's client; the dynamic import and the
  "fallback to the user client" branch are gone. `types/database.ts` regenerated.
- ADR-0005 exception register: unchanged and exact (`app/api/v1/**` + `lib/api/**` until P1-37;
  `lib/messaging/dispatcher.ts`, `lib/webhooks/**`, `app/api/cron/**` until V2-04). `lib/api/**`,
  `lib/messaging/dispatcher.ts` and `lib/webhooks/**` take the client as a parameter and do not import the factory.
  Census at `f37f917` (`service-role-census.txt`): 17 importers of `@/lib/supabase/system`, all on the allow-list or
  the register; `SUPABASE_SECRET_KEY` read only in `lib/supabase/system.ts` (plus the schema in `lib/env.ts`); the
  only value import of `@supabase/supabase-js` in `app/ lib/ features/ components/ proxy.ts` is the factory's.

## Tests that fail without the change (tool output in `evidence/03-02/`)

| Spec / check | Without the change | File |
|---|---|---|
| `tests/storage/no-service-role-fallback.spec.ts` | HEAD~ provider restored: 4 of 5 fail (it builds a client from the secret key and calls storage) | `negative-storage-fallback.txt` |
| `tests/referrals/referral-source-clinics.spec.ts` | function dropped (000026 not applied): suite fails in `beforeAll` (`PGRST202`) | `negative-referral-rpc-absent.txt` |
| `npm run typecheck` | a module importing `@/lib/supabase/admin`: `TS2307` | `negative-admin-import-typecheck.txt` |
| `tests/security/system-db.spec.ts` | the module does not exist before 03-02 | (suite cannot load) |

`system-db.spec.ts` (12 cases): one stdout line with keys `ts, level, event, reason, module` and nothing on stderr;
one line per call for every reason, each naming its owner; 7 unknown reasons and 4 non-string reasons throw and write
nothing; no key → throws, logs nothing; the client reads a tenant row an anon client cannot (it is the service role).
`referral-source-clinics.spec.ts` (7 cases): B sees nothing before A's referral and A's id/name/phone after; C's ids
return nothing (alone or mixed); C and the sender A learn nothing; empty list; anon `42501`; catalog `prosecdef`,
`search_path=""`, EXECUTE only for `authenticated`; `getInboundReferrals` for B returns A as `originating_clinic`.

## Deviations

1. **Event name `db.system_acquired`, not `system_db.acquired`.** The 03-09a logger's `EVENT_PATTERN` does not allow
   `_` in the first segment, so the plan's name would be written as `log.invalid_event`. The logger was not changed.
2. **Reasons:** the plan's examples `share.resolve` / `share.sign` became `share.sign`, `share.receipt_pdf`,
   `share.reschedule_notify` (one per exported step; token resolution is part of each step).
3. **Rule 2:** `service_role` EXECUTE also revoked on `referral_source_clinics` (it has no `auth.uid()`, so it could
   only ever get zero rows; least privilege). The 03-01 anon definer allowlist is unchanged (anon cannot execute it).
4. Files outside the plan's list: `tests/api/health-probes.spec.ts` (its "service role unreachable" mock now targets
   `@/lib/supabase/system`). `scripts/inventory-server-actions.ts` does not name `admin.ts`, so it is unchanged.
5. **Lint fixture:** the orchestrator's example "a lint fixture proving a second factory / an import outside the
   allow-list is caught" belongs to 03-04 (`eslint.config.mjs`, `lint-fixtures/p1-34/**` are 03-04's files; the plan
   maps the lint proof there). Handoff written with the exact allow-list and census.
6. The new `referral_source_clinics` failure branch logs with `console.error` + `errorTag`, the file's existing pattern;
   03-09c converts the file.

## Observations

- e2e: the web server logged 6 `Error: aborted` / `ECONNRESET` lines, all during the iPhone smoke specs that end right
  after the landing page renders (the browser closes with a request in flight). Every test passed first time; none of
  these routes touch the system client.
- Cross-tenant guard/canary/P0-13 suites pass unchanged (the referral RPC runs after `assertPerm`).

## Threat flags

| Flag | File | Description |
|---|---|---|
| threat_flag: info | `supabase/migrations/000026_referral_source_clinics.sql` | an authenticated member of any tenant learns name and phone of clinics that referred to it (same data the v1 service-role read returned; scoped to RLS-visible inbound referrals, T-03-18) |
