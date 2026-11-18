# ADR-0005 amendment A4 (proposed): invite acceptance may use the Auth admin API through features/auth/system

- **Status:** Proposed by the agent as CTO under PO delegation (ruling R-44, 2026-11-13); implemented in V2-05 plan
  05-07b. Applied to `docs/adr/0005-confine-service-role-client.md` only after the PO confirms the rulings (05-P1).
  Rejecting it is a revert of one ESLint zone, one `SystemDbReason` and the call site
  (`features/auth/invite-flows.ts` → `features/auth/system.ts#redeemInvitationWithPassword`).

## Context

AUTH_REDESIGN §3.2 lets an invited person without an account set a password from the invitation link. Supabase gives
no way to create a confirmed account for a chosen address from the browser, and the Auth admin API needs the service
role. ADR-0005 Decision 2 allows the service-role client only in `lib/jobs/internal/**`, `features/<domain>/system.ts`,
`app/api/{jobs,webhooks}/**` and the exception register; a server action may not import a `features/*/system.ts`
module (D2, enforced since V2-03 03-04). The invite flow is a public, token-gated server action: none of the allowed
places. A1 (share routes) and A3 (the Send Email hook) are the precedents for a narrow, single-module allowance.

## Decision (an allow-list addition to Decision 2, not a register entry)

`features/auth/invite-flows.ts` may import `features/auth/system.ts`, and nothing else on the service role, to call one
function, `redeemInvitationWithPassword(tokenHash, password)` (reason `auth.invite_accept`), and only after, in order:

1. the raw token's shape (64 hex) and its SHA-256 (the only form the database knows);
2. the server-side Turnstile check (`lib/auth/turnstile.ts`, R-46; fail closed: an unset secret refuses);
3. the password policy and FT-05 (`isPwnedPassword`).

`redeemInvitationWithPassword` asks the database (`public.invitation_accept_context`, migration 000089, service role
only, session-role rule R-38) for the invited address and the account that owns it, then:
- no account → `auth.admin.createUser({ email: <that address>, password, email_confirm: true })`;
- an unconfirmed account → `auth.admin.updateUserById(id, { password, email_confirm: true })`;
- a confirmed account → refused ("sign in to accept"; a password is never overwritten);
then `public.consume_invitation_for(user, hash)` (000088: address-bound, idempotent for the same user). The Auth admin
API is therefore used only for the address the database validated for that token; the module exports no general
`createUser`. No other `features/*/system` module and not the factory itself may be imported in `invite-flows.ts`.

## Verification

- One ESLint zone (`eslint.config.mjs`, `A4_AUTH_ONLY`) for exactly that file; pass fixture
  (`lint-fixtures/p1-34/auth-system-import.ts` at `features/auth/invite-flows.ts`) and fail fixtures (the same import
  from `features/staff/actions.ts` and `features/auth/actions.ts`; the factory, another domain's system module and
  `features/sharing/system` at the A4 module) in `tests/security/p1-34-lint-gates.spec.ts`; the P1-34 counters test
  lists the module as a `feature_system` importer and never as a factory importer.
- `REASON_OWNER["auth.invite_accept"] = "features/auth/system"` (`tests/security/system-db.spec.ts` iterates it).
- `tests/integration/auth/accept-invite.spec.ts`: Turnstile, policy and Pwned refusals change no account; a confirmed
  account is never overwritten; the account is created only for the invited address.
- `supabase/tests/database/invitation_accept_context.test.sql`: service role only, SYSTEM_ONLY with a leaked grant.
- Guard manifest: `features/auth/actions.ts#acceptInviteWithPasswordAction` is `{ publicToken }` (no session; the token
  is the authorisation); its unauthenticated and cross-tenant legs run in `tests/security/guard-actions.spec.ts`.
