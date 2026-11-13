# V2-03 adversarial review: service role, lint boundaries, migrations, RLS and RPCs (group B)

- Scope: `origin/feature/v2..3f81bfb`. `lib/supabase/system.ts` and its importers, `eslint.config.mjs` boundary
  rules and `lint-fixtures/p1-34/**`, `supabase/migrations/000025`–`000028`, migration immutability, types freshness
  and drift gates.
- Method: read the requirements first (03-PLAN 03-02/03/04/07/09b, ADR-0005 + A1). Then ran exploits against the
  **local** stack (migrations at `000028`) as `anon` and `authenticated`, each in a transaction that was rolled back.
  The synthetic tenants, users and patients were created inside those transactions (`*@example.test`, `Synthetic …`).
  After the run, `tenants` and the probe users show 0 rows. Lint bypasses were run with
  `npx eslint --stdin --stdin-filename features/patients/service.ts` from scratch files; no repository file was
  changed. Implementer records (`03-07-D1-SPIKE.md`) were read only after the findings were written, to check whether
  a finding was already a known deferral.
- Counts: **Critical 0 · High 1 · Medium 4 · Low 6 · Info 4**.

---

## High

### H-1 Any staff member can forge the payment actor and break the payment invariants by writing to `payments` directly (the RPC's guarantees are advisory)

`supabase/migrations/000027_record_payment_rpc.sql:53-55` grants `authenticated` INSERT on
`(id, tenant_id, invoice_id, amount, payment_method, reference_number, notes, recorded_by, recorded_at, command_id)`.
The only INSERT policy is `payments_insert_tenant`, which checks `tenant_id` and nothing else. The browser already
holds the user's JWT and the publishable key, so any signed-in nurse, receptionist or doctor can call PostgREST
directly and:

1. set `recorded_by` to **another user's id** (actor spoofing, the SEC-02 property ADR-0005 Verification 2 promises);
2. record any amount, including far above the balance, on any invoice in their tenant, in any status. This skips the
   lock, `OVERPAYMENT`, `INVOICE_NOT_PAYABLE`, the status transition, the audit row and the outbox;
3. choose a `command_id`. The RPC then reports this forged row as a successful idempotent replay of its own command
   (`replayed: true`) and adds it into `paid_total` from then on.

The same caller can also run `UPDATE invoices SET total_amount = …, status = …` (`invoices_update_tenant`) and insert
`audit_logs` rows with any `actor_id`/`actor_type` (see M-2). So nothing in 000027 holds while these direct writes stay
open.

Reproduction (local, rolled back; u1 is a **nurse** in tenant A, u2 is a member of tenant C only):
```sql
set local role authenticated;
set local request.jwt.claims = '{"sub":"<u1>","role":"authenticated"}';
insert into payments (tenant_id, invoice_id, amount, payment_method, recorded_by, command_id)
values ('<A>', '<invoice A, total 100, issued>', 99999, 'cash', '<u2>', '<cmd>')
returning amount, recorded_by;           -- 99999.00 | <u2>   (accepted)
select status from invoices where id='<invoice>';            -- issued (unchanged)
select public.record_payment('<A>','<invoice>',99999,'cash',null,'<cmd>');
-- {"replayed": true, "paid_total": 99999.00, "balance_due": 0, "total_amount": 100.00, ...}
```
Over HTTP this is `POST /rest/v1/payments` sent with the user's own access token.

Status: this was in v1 before V2-03. `03-07-D1-SPIKE.md` §V2-07 hands "direct writes bypass the command" to V2-07,
but it does not mention actor forgery (`recorded_by` set to another user) or audit forgery. 03-07 also re-granted
`recorded_by` in the new column list, so it re-approved the forgeable column instead of closing it.

Fix (expand-safe, can ship now, does not wait for the V2-07 contract):
```sql
CREATE FUNCTION public.payments_actor_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN            -- every user-path insert, RPC or direct
    NEW.recorded_by := auth.uid();
    NEW.recorded_by_system := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_actor_guard BEFORE INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION public.payments_actor_guard();
```
Also drop `recorded_by` and `command_id` from the `authenticated` column grant, or reject a direct insert that carries
a `command_id`, so the replay path only sees RPC-written rows. Then either bring forward the V2-07 contract
(revoke INSERT on `payments` and UPDATE of `invoices.status`/`total_amount`) or record the remaining overpayment gap
as an accepted risk at the gate.

---

## Medium

### M-1 The `communication_queue` "failed in 24h" count in `readiness_probe` does a full table scan, and anyone on the internet can trigger it

`000025_readiness_probe.sql:15` says "Every count is served by the existing (status, next_retry_at) indexes". That is
not true for `messages_failed_24h` (`:35-37`). `idx_comm_queue_dispatch` is a **partial** index
(`WHERE status IN ('pending','processing')`), so the failed/dead_letter count can only use a sequential scan. With
`enable_seqscan = off` the plan is still `Seq Scan on communication_queue … cost=10000000000`. This table holds
every message of every tenant forever. The function is `anon`-executable, and the publishable key is public, so it
can be called directly, without going through `/api/ready`:
```bash
curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/readiness_probe" -H "apikey: <publishable key>" -d '{}'
# {"db": true, "latest_migration": "000028", "messages_pending": 0, ...}   (verified locally)
```
Each anonymous request costs one full scan of the platform-wide message table, an unauthenticated way to amplify load
on the database. The webhook failed count uses the status index but then reads every failed row ever stored.

Fix: in a new migration, add `CREATE INDEX … ON communication_queue (updated_at) WHERE status IN ('failed','dead_letter')`
and the same shape for `webhook_delivery_queue` (status `failed`). Better still, stop granting EXECUTE to `anon`: give
`/api/ready` its own path, for example a secret-gated route or a cached value refreshed by the cron, and correct the
migration comment.

### M-2 Any member can write audit rows that claim to come from the system or from another user

`audit_logs_insert_member` only checks `tenant_id`. 03-07 introduces `actor_type = 'system'` +
`metadata.system_actor` as the marker of a system-path payment. Reproduced (local, as the nurse u1, accepted):
```sql
insert into audit_logs (tenant_id, actor_id, actor_role, actor_type, action, entity_type, entity_id, metadata)
values ('<A>', null, 'system', 'system', 'invoice.payment_recorded', 'payment', gen_random_uuid(),
        '{"system_actor":"system:payment_webhook"}');
```
This was in v1 before V2-03, but the D1 pattern ("audit in the same transaction, actor = auth.uid()") is only
trustworthy if direct inserts cannot imitate it.

Fix: a BEFORE INSERT trigger that, when `auth.uid()` is not null, forces `actor_id := auth.uid()`,
`actor_type := 'user'` and `actor_role` := the caller's membership role. Or move audit writes behind a definer
function and revoke INSERT from `authenticated` (V2-07 contract).

### M-3 Several value imports from Supabase packages create a privileged client and pass every boundary rule

The no-restricted-imports `paths` restriction (`eslint.config.mjs:246-251`) only names `createClient`. Each probe
below, linted with the real config at `features/patients/service.ts`, gives **0 errors**:

| Probe | What it gets |
|---|---|
| `import { SupabaseClient } from "@supabase/supabase-js"; new SupabaseClient(url, key)` | A second service-role factory. `createClient` is just `new SupabaseClient`. `lib/api/auth.ts:3` and `lib/api/doctor-guard.ts:1` already import it as a value. |
| `import { GoTrueAdminApi } from "@supabase/supabase-js"` (re-exported from auth-js), `import { PostgrestClient } from "@supabase/postgrest-js"` | Direct admin or REST clients. `SUPABASE_CLIENT_PACKAGES` (`:130`) covers only `supabase-js` and `ssr`. |
| `serverEnv()[["SUPABASE","SECRET","KEY"].join("_")]` | Reads the secret key. The `secretKey` rule matches only whole identifiers and literals. |
| `const r = require; r("@/lib/supabase/system")`, `module.require("@/lib/supabase/system")` | Dynamic loading of the factory. The selector requires `callee.name === "require"`. |
| `// eslint-disable-next-line @typescript-eslint/no-restricted-imports` above `import { getSystemDb } …` | Silences the rule. No `noInlineConfig` and no check against disable comments; the `scripts/ci/p1-34-counters.mjs` census respects inline directives, so the import also disappears from `static-checks.json`. |

The fixtures only cover `createClient` (named, namespace and dynamic). None of the above is covered, and ADR-0005
Verification 4 ("ESLint finds one service-role factory") cannot be relied on as evidence while these pass.

Fix:
- Restrict the `SupabaseClient` value import (`allowTypeImports: true`) and the `GoTrueAdminApi`/`GoTrueClient` value
  imports.
- Ban `@supabase/{postgrest,auth,storage,realtime,functions}-js` outside the factory.
- Add `CallExpression[callee.property.name="require"]`, plus any `require` that is not called directly, to
  `dynamicImports`.
- Make the census run with `allowInlineConfig: false`. Fail the static job on any `eslint-disable` comment that names
  `no-restricted-imports` or `no-restricted-syntax` without a register reference, or set
  `linterOptions.noInlineConfig` for those rules.
- Restrict computed member access on `serverEnv()`. At minimum, have the factory's census also look for `serverEnv()[`.
- Add a fixture for each of these.

### M-4 The allow-list and exception-register zones let the service role leak into request paths, and `lib/jobs/**` contradicts ADR-0005 D2

The rules restrict which files may import a *system module*. They do not restrict who imports the *modules that sit in
an allowed zone*. Every zone below is allowed to import the factory, and every one is importable from anywhere:

- `eslint.config.mjs:300` `lib/webhooks/**`: request-path services already import it (`features/billing/service.ts`,
  `features/consultation/service.ts`, `features/labs/service.ts`, `features/prescriptions/service.ts`,
  `features/referrals/service.ts`, `features/webhooks/service.ts`, …). If `lib/webhooks/outbox.ts` were changed to
  call `getSystemDb` (which is exactly how v1 worked around owner/admin-only outbox RLS), the service role would be on
  every request path and lint would stay green. The census would show only `lib/webhooks/outbox.ts`, which sits
  "inside the register".
- `eslint.config.mjs:296` `lib/jobs/**` as a whole. ADR-0005 D2 says the **enqueue surface** that request paths import
  "never calls `getSystemDb`". The rule allows it, and the README marks `factory-import.ts` as **passing** at
  `lib/jobs/x.ts`. Wrapping the factory there (`export const db = () => getSystemDb("api_v1")`) and importing it from
  an action passes lint (probe p4).
- `:298` `lib/api/**`, which `lib/auth/public-paths.ts` imports.
- The tooling and ignored trees: `scripts/**` has the import rule off (`:318`), and `docs/**` and `lint-fixtures/**` are
  not linted at all (`:335-337`). Nothing stops app code from importing them: `import { getSystemDb } from
  "@/scripts/launder"` passes lint (probe p7). `lint-fixtures/p1-34/factory-import.ts` itself exports
  `systemDb()` built on the factory.

Fix:
- Narrow `lib/jobs/**` to `lib/jobs/internal/**` for `factory`, as the ADR says.
- Add a `no-restricted-imports` pattern that stops non-zone code from importing register files that import the factory.
  At minimum, apply it to `@/lib/webhooks/*` except `outbox`/`signer`/`ssrf`, or split `lib/webhooks` into a
  request-safe part and a `dispatcher` part and register only `lib/webhooks/dispatcher.ts`.
- Ban `@/scripts/**`, `@/tests/**`, `@/docs/**` and `@/lint-fixtures/**` (and their relative spellings) from app code.
- Add fixtures for laundering through a zone and through `scripts/`.

---

## Low

### L-1 `record_payment` always fails when called inside a subtransaction

`private.outbox_payment_recorded` (`000027:80`, `:85`) accepts a payment only if `p.xmin = pg_current_xact_id()::xid`.
`pg_current_xact_id()` is the **top-level** xid, while a row inserted inside a savepoint or a plpgsql
`BEGIN … EXCEPTION` block gets a **sub**-xid. Reproduced: the same valid call that succeeds at top level fails with
`OUTBOX_SUBJECT_INVALID` inside `SAVEPOINT s`. A V2-04 job handler or a V2-07 command that wraps the call in an
exception block will therefore always fail.

The reverse also holds: `xmin` equals the current xid for rows **updated** in this transaction, so "inserted now" is
really "written now". This is not reachable today (`private` is not exposed and `payments` has no UPDATE policy).

Fix: pass the row's identity out of the INSERT instead. For example, have `record_payment` hand the outbox function
the values it just inserted, or check `p.command_id = <the caller's command id>` together with a transaction-local
marker (`set_config('app.outbox_payment', v_payment_id::text, true)` checked in the helper), rather than `xmin`.

### L-2 The ingest function's second scrub can make a valid message too long, so the event is dropped

`000028:171` checks `char_length(v_message) <= 500` **before** the regex scrub at `:200-202`. The scrub can lengthen
text (`?a` becomes `?[QUERY]`, a 6-digit run becomes `[NUMBER]`), and then the table CHECK
`error_events_message_check` (`:46`) rejects the insert. Reproduced with 166×`"?a "` and with 71×`"123456 "`
(`ERROR: … violates check constraint "error_events_message_check"`).

This is reachable from the app path. `scrubMessage` cuts the message to 500 characters *after* replacing, so a
message whose cut ends inside `?[QUERY]` (for example `…?[QUE`) is re-expanded by the DB to 503 characters and that
error is lost. The sink then logs it only as `refused`.

Fix: `v_message := left(v_message, 500)` after the scrub, in a new migration. Also make the app cut on a token
boundary.

### L-3 The database's second scrub misses spaced phone numbers and Aadhaar numbers

`000028:200-202` only catches unbroken runs of 6 or more digits. `"phone 98765 43210 aadhaar 1234 5678 9012"` was
stored verbatim (local probe, key installed in a rolled-back transaction). The app scrubber is the first line and
does handle these. The DB line is weaker than its comment claims. Fix: add `[0-9][0-9 -]{8,}[0-9]` → `[NUMBER]`, or
the spaced mobile and Aadhaar patterns from `lib/observability/scrub.ts`.

### L-4 `readiness_probe` tells unauthenticated callers the deployed schema version and platform-wide queue volumes

`latest_migration` and the four platform-wide counts are returned to `anon` (verified over local PostgREST). The plan
accepts this ("anon-executable by design"), but `latest_migration` fingerprints the deployed schema version and the
counts reveal platform message volume and outages. Fix: return only `db: true` to `anon`, and the counts only to an
authenticated platform admin or a secret-gated `/api/ready`. Ties in with M-1.

### L-5 The system client's log line is not tied to the calling module, and `/api/v1` acquires the client before checking auth

`lib/supabase/system.ts:44-66` accepts any member of the closed reason set from any allowed importer. Nothing ties
`api_v1` to `app/api/v1/**`, so the `module` field in `db.system_acquired` is self-asserted. Every `/api/v1` handler
calls `getSystemDb("api_v1")` *before* `authenticateApiKey` checks the env switch and the key
(`app/api/v1/appointments/route.ts:15-16` and the other 13). Each unauthenticated hit, including in a tier where the
API is disabled and the proxy is bypassed, writes a `db.system_acquired` line. A missing secret also turns a 404 into
a 500.

Fix: call `apiV1Enabled()` and authenticate before acquiring the client. Optionally add a lint selector per zone that
pins the `getSystemDb` reason literal to its owning file glob.

### L-6 Two open PRs can reuse the same migration number, and this is only caught after merge

`scripts/ci/migration-immutability.mjs` compares against the merge base. Two PRs that both add `000029_*` each pass
alone. The duplicate is caught only by the push run on `feature/v2` after both have merged, because base files are
included in `byNumber`. By then the second migration has already merged and would make `db push` fail.

Fix: require "branches up to date before merging" on `feature/v2`, or run the gate in a `merge_group` /
on-push-to-base job that blocks deploy. Neither the workflow nor its policy checker could confirm this setting is on.

---

## Info

- **I-1** The `private` and `ops` schemas are kept out of the API only by `[api] schemas` in the local `config.toml`.
  The hosted "Exposed schemas" setting is configured outside the repo and no drift gate checks it. Locally, PostgREST
  refuses both (`PGRST106 Invalid schema: private/ops`, verified). Add the hosted setting to the AUTH-02-style
  config-as-code check or to the E1a dump review.
- **I-2** `ops_ingest_error` is callable by anyone holding the public publishable key. Without the ingest key it
  costs one vault decrypt and one SHA-256 before refusing (`42501`), which is fine. With the key, anyone could fill the
  500-a-day cap of new fingerprints and hide real errors (T-03-02 accepted; verified that 600 new fingerprints → 500
  rows + overflow counter). The key is server-only (`ERROR_INGEST_KEY`, never `NEXT_PUBLIC_*`), and `/api/diag/error`
  requires `CRON_SECRET` and is off in production. Good.
- **I-3** `record_payment` differs from the plan: it adds `p_tenant_id` (the right fix for multi-membership AR-M2b) and
  drops the function-level `statement_timeout` (documented, `000027:23-26`). Both are acceptable. A permission
  regression to watch: the RPC's role list currently allows every role, including `nurse` (mirrors
  `appointments:edit`).
- **I-4** `referral_source_clinics` uses every tenant the caller belongs to, not the active one. That matches the
  `referrals_target_tenant_select` RLS it mirrors, so it leaks nothing new.

## What held up (verified by exploit, not by reading)

- `record_payment`:
  - a user session passing `p_system_actor` → `ACTOR_INVALID`;
  - direct insert of `recorded_by_system` → `permission denied` (column grant);
  - UPDATE of an own payment to a system actor → 0 rows (no UPDATE policy);
  - `NaN`, `Infinity` and `0.001` → `AMOUNT_INVALID`;
  - active tenant B with an invoice of tenant A (dual member) → `INVOICE_NOT_FOUND`;
  - overpayment through the RPC → `OVERPAYMENT`;
  - `search_path=''` on all four new functions plus the `private`/`ops` helpers;
  - EXECUTE grants exactly as documented (`proacl` checked); `ops.*` functions executable by `postgres` only;
  - `ops` schema has no USAGE grant to any API role; RLS is enabled on both `ops` tables.
- `private.outbox_payment_recorded` refuses a payment id that was not inserted in the current transaction.
- `referral_source_clinics`:
  - the target clinic's member gets the sender's name and phone;
  - the sender gets nothing for the target;
  - an unrelated or guessed id → 0 rows;
  - `anon` cannot execute it;
  - the target cannot rewrite `referrals.tenant_id` to plant a source (`referrals_target_update_guard`).
- Lint: canonical, relative, traversal, `//` and `/./` spellings, `.ts`/`/index` suffixes, `import x = require()`,
  template-literal `import()`, namespace and aliased `createClient` imports are all caught.
- `tsconfig` has only the `@/*` alias and no `baseUrl`, so no bare-path bypass.
