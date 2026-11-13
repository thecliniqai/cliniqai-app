# V2-04 proposed amendments to ADR-0005 (confine the service-role client)

**Status: proposed, not applied.** `docs/adr/0005-confine-service-role-client.md` is unchanged. The PO confirms or
rejects each amendment at the V2-04 gate (04-P14, rulings R-6 and R-43); only then is the ADR text edited. Until then
the code follows the proposals below, and every allowance they need is one ESLint zone with a pass and a fail fixture
(`tests/security/p1-34-lint-gates.spec.ts`), so rejecting an amendment is a revert of that zone and its call site.

## A2: request-path enqueue takes the active tenant only as a constraint (R-6, revised for the 03-07 D1 finding)

> Request-path enqueue derives the tenant from the subject row. It takes the caller's active tenant
> (`ServiceContext.tenantId`, session-derived, never request input) only as a constraint the subject row must match,
> and requires membership in it; a mismatch reads as not found. It is never the source of the row's tenant. Until V2-05
> adds a database-side active tenant, this argument is what stops a multi-clinic user acting in clinic A from
> enqueueing for clinic B.

Replaces D3's "accepts no tenant argument". Implemented by `public.enqueue_message` (000035) and
`public.enqueue_webhook_event` (000036); proven by the dual-member cases of
`tests/jobs/enqueue-message-rpc-db.spec.ts` and `tests/jobs/enqueue-webhook-rpc-db.spec.ts` and by guard leg 3b, with
the "any membership" variant shown failing (`evidence/04-03a|04-03b/negative-enqueue-any-membership.txt`).

## A3: the Send Email hook may record its delivery id through one system function (R-43)

> `app/api/auth/send-email/route.ts`, a Standard-Webhooks-signed server-to-server endpoint of Supabase Auth (an inbound
> webhook in all but path), may import `features/auth/system.ts` and call it only after the signature check, only to
> record the delivery id (reason `auth.send_email_hook`).

Why: D2 lists `app/api/webhooks/**` but not `app/api/auth/**`; the hook route is authenticated by its signature like
the inbound webhooks, and its retries can land on another server instance, which only a shared store can dedupe
(03-11b threat flag, 03-13a residual 6). An anon-callable dedupe RPC instead would let anyone fill the table.

Implemented (04-03c) as:
- `features/auth/system.ts` (`import "server-only"`): `authHookDeliveryBegin(webhookId)` /
  `authHookDeliveryFinish(webhookId, outcome)` on `getSystemDb("auth.send_email_hook")` →
  `public.inbound_webhook_begin/finish('supabase_auth_hook', <webhook-id>)` (service role only, migration 000037).
  Provider + id + timestamps only; fails open (a store error never blocks an auth email).
- ESLint: one zone for exactly `app/api/auth/send-email/route.ts` allowing `featureSystem` with an extra pattern that
  refuses every other `features/*/system` (`A3_AUTH_ONLY`); the factory itself stays refused there. Pass:
  `auth-system-import.ts` at the route. Fail: the same fixture at `app/api/auth/other/route.ts` and at a feature
  service; the factory, another domain's system module and `features/sharing/system` at the route.
- `REASON_OWNER["auth.send_email_hook"] = "features/auth/system"`.

## Register state after 04-03c (Verification 4: "From V2-04 the register holds only the `/api/v1` entry")

The V2-04 register entries (`app/api/cron/**`, `lib/messaging/dispatcher.ts`, `lib/webhooks/**`) are deleted with their
passing cases (03-04 handover). The register is now `app/api/v1/**`, `lib/api/**` (owner P1-37), exported as
`P134_CENSUS.exceptionRegister`; `scripts/ci/p1-34-counters.mjs` reports `exception_register_entries: 2` (5 at the end
of V2-03) and `exception_register_importers` (only `app/api/v1/**` files). This is the ADR's own end state and needs no
amendment; A3 is an allow-list addition, not a register entry.
