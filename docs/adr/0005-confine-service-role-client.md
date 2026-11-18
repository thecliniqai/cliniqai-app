# 0005: Confine the service-role client; no overrides in server actions

- **Status:** Accepted (G0, PO sign-off via PR #1, 2026-11-11). Amended after the G0 isolated review
  (VERIFICATION_LOG, "ADR-005 ratification review" and "G0 re-review of the amendments"). Source:
  `docs/v2/ARCHITECTURE_DECISIONS.md` ADR-005; findings SEC-01, SEC-02, ARC-01; rulings C3, C20, C31, C50 (amended 2026-11-11 after the G0 re-review).
- **Context:** Exported `"use server"` functions accept `sessionOverride`/`clientOverride` (and variants
  such as `tenantIdOverride`). With `sessionOverride` they skip `requirePermission()` and switch to the
  service-role client, e.g. `features/patients/actions.ts:249-256` (`searchPatients`). Server actions are
  callable from the browser with caller-chosen arguments. In the four confirmed browser-reachable actions
  (`searchPatients`, `updateClinicSettings`, `updateStatutorySettings`, `toggleGlobalConsent`) anyone who
  knows a clinic UUID can search that clinic's patients and write its settings and consent records (SEC-01);
  `getPatient`/`getPatients` (`features/patients/actions.ts:174,278`) use the same pattern and their exposure
  is pending OI-6 (C31). On about 80 other actions the override lets an authenticated caller bypass role
  checks and spoof the acting user within RLS (SEC-02). Other cited sites: `features/patients/actions.ts:255`,
  `features/patients/consent.ts:163`, `features/settings/actions.ts:48,179`. There are five separate
  service-role client factories: `lib/supabase/admin.ts`, `features/appointments/actions.ts`,
  `features/auth/dev-actions.ts`, `lib/messaging/dispatcher.ts` and `lib/storage/supabase-provider.ts`
  (erratum C3), plus service-role use on request paths that is not an override seam (`/api/v1`, cron
  runners, outbox enqueue, storage and AI fallbacks, readiness probe, referral clinic names).
- **Decision:**
  1. **No caller-supplied acting identity.** No export of a `"use server"` module, and no non-action module
     that can switch to the service role on a caller-supplied session or client, accepts the *acting*
     principal from the caller: no session, principal or DB client, no acting tenant/clinic id, no acting
     user/actor id, as a parameter or as an input field. The acting tenant and actor always come from
     `getContext()`/`requirePermission()`. *Target* ids are allowed (the clinic a referral is sent to, a
     doctor or staff member to book or remove, a tenant chosen by a platform admin) and are authorised
     server-side through RLS or `has_permission()`. All `*Override` parameters are removed and
     `notifyPrescriptionIssued` is deleted (P0-01). Tests call domain services with an explicit context.
  2. **One confined factory.** `getSystemDb(reason)` lives in `lib/supabase/system.ts` (`import
     "server-only"`), replaces all five factories, and is importable only from `lib/jobs/**` (internal
     part, below), `features/*/system.ts` and `app/api/{jobs,webhooks}/**` (C20; additions: A1 public share routes,
     A3 the Send Email hook route, below). Every call emits one
     structured log line with the reason code and the calling module, never tenant data or PHI.
     `features/*/system.ts` modules carry `import "server-only"`, never `"use server"`, and may be imported
     only from the same allowed paths. Supabase Auth admin calls live in `features/auth/system.ts` (C50).
     `lib/jobs/**` is split: an **enqueue surface** that request paths may import, which never calls
     `getSystemDb` (it uses the user client or the enqueue RPC), and an **internal part** (claim, handlers,
     runner) that may call it and is importable only from `app/api/jobs/**` and other `lib/jobs` internals.
     Request-path code never falls back to the service role on error.
  3. **Public links** use SECURITY DEFINER RPCs scoped to the token, not service-role queries (P0-04).
     **Request-path enqueue** of messages and webhook events uses one SECURITY DEFINER enqueue RPC that
     derives the tenant from `auth.uid()` and accepts no tenant argument (**amended by A2, 2026-11-14: the
     active tenant is accepted as a constraint only**; V2-04; P1-05 RPCs later write the
     outbox in the same transaction). **Readiness** (`/api/ready`) uses one SECURITY DEFINER health RPC
     returning counts only, with no bucket check (V2-03, P1-15); storage health comes from the backup job's
     alerts (FT-02/FT-03).
  4. **Enforcement (ESLint only, C20/C50):** `no-restricted-imports` confines `lib/supabase/system.ts`,
     `features/*/system`, the internal part of `lib/jobs`, and value imports of `createClient` from
     `@supabase/supabase-js` and `createServerClient` from `@supabase/ssr`, which are owned only by
     `lib/supabase/system.ts`, `lib/supabase/server.ts`, `lib/supabase/client.ts` and `middleware.ts`;
     `no-restricted-syntax` bans the identifier or string `SUPABASE_SERVICE_ROLE_KEY` outside the factory and
     `lib/env.ts`, and dynamic `import()`/`require()` of the factory. `tests/**` and `scripts/**` are
     excepted from both rules (the local-harness seed helpers need a privileged client). A fixture per
     bypass, including an action importing a `lib/jobs` internal, proves each rule fires.
- **Phasing and transition:** Items 1 and the public-link part of 3 land in V2-01 (P0-01, P0-04); its
  inventory is generated by a tool at the V2-01 base commit, not copied from the roadmap counts. Items 2, 4
  and the readiness RPC land in V2-03 (P1-34, P1-15; plans 03-02 and 03-04), enforced in CI from then on.
  Sites that cannot move by V2-03 go on an **exception register** in the ESLint config; each entry names its
  owner phase and is deleted by it:
  - `lib/messaging/dispatcher.ts`, `lib/webhooks/**` and `app/api/cron/**`: until V2-04, which adds the
    enqueue RPC and replaces the cron runners with `app/api/jobs/run`.
  - `app/api/v1/**` and `lib/api/**` (disabled by the env switch, PO-16): until P1-37. If P1-37 is still
    P2 at UAT start, the entry may remain only if the zod env schema forces the switch off in production
    and a test proves every route returns 404 in a production build (roadmap §17.1).
  Every other current service-role importer moves to an allowed path, an RLS/RPC path, or is deleted by
  V2-03. Adding a path to the allow-list or the register needs an amendment to this ADR or a superseding
  ADR accepted at a gate (`docs/adr/README.md`).
- **Alternatives considered:** keep overrides behind `NODE_ENV === 'test'`. Rejected: brittle, and the
  attack surface stays in production builds.
- **Consequences:** (+) closes the unauthenticated cross-tenant hole and actor spoofing; (−) the DB-backed
  tests that rely on overrides must be restructured. V2-01a first runs them unchanged on the local stack as
  the regression net; V2-01 (plan 01-01) then rewires them to call domain services with an explicit
  context, and they must pass on the local stack both before and after the removal.
- **Verification:**
  1. For every export of a `"use server"` module in the generated V2-01 inventory: an unauthenticated call
     with a forged override gets an authentication error (SEC-01). For non-action modules in the inventory
     (e.g. the public-token and inbound-webhook helpers in `features/appointments/actions.ts`): the override
     parameter is gone and their only importers are allowed or registered paths.
  2. An authenticated receptionist in tenant A who passes tenant B's id as the acting tenant, or another
     user's id as the actor, gets A-scoped results or a denial, and the recorded actor and audit `actor_id`
     equal the session user (SEC-02).
  3. An AST lint rule rejects, on the modules of Decision 1, parameters or input fields named `*Override`,
     `actorSession`, `session`, `client`, `actorId`, `createdBy`/`recordedBy`/`signedBy`, and an acting
     `tenantId` on tenant-scoped actions (the plain grep stays as a backstop); the P0-13 guard test over
     every server action and route handler (V2-02) is the standing proof.
  4. From V2-03: ESLint finds one service-role factory and zero service-role imports outside the allow-list
     and the exception register; the bypass fixtures fail lint; a unit test shows `getSystemDb(reason)`
     emits one PHI-free log line with the reason. From V2-04 the register holds only the `/api/v1` entry.

## Amendment A1 (V2-01, 2026-11-12) — public share-link importers

- **Status:** Proposed at the V2-01 gate (agent acting as CTO under PO delegation; PO accepts at G3-partial).
- **Context:** Decision 3 resolves public links through token-scoped SECURITY DEFINER RPCs. Two steps still need
  a privileged client after the RPC has resolved the token: signing a storage object for the shared document and
  rendering the receipt-PDF fallback. Decision 2 lists `features/*/system.ts` as an allowed location, but its
  importer list (`lib/jobs/**`, `features/*/system.ts`, `app/api/{jobs,webhooks}/**`) does not include the public
  share pages.
- **Decision:** `features/sharing/system.ts` (`import "server-only"`) may be imported by exactly these public token
  routes: `app/api/r/[token]/route.ts`, `app/r/[token]/page.tsx`, `app/api/reports/view/route.ts`,
  `app/reports/view/page.tsx`, `app/api/reschedule/[token]/route.ts`. It may only act on the object or record the
  anon RPC returned for the token, after checking the storage path lies under the token's tenant (and, from 01-08,
  matches the resource's own ids). Token lookup itself never uses the service role.
- **Verification:** `tests/security/share-tokens.spec.ts` (cross-tenant, wrong-type, expired, revoked, single-use,
  path checks). From V2-03 the `no-restricted-imports` rule encodes this importer list and a fixture proves an
  import from any other route fails lint.

## Amendments A2 and A3 (V2-04, applied 2026-11-14)

- **Status:** Accepted by the agent as CTO under PO delegation (2026-11-13; rulings R-6, R-43); text applied at the
  V2-04 phase close (2026-11-14) and listed in `.planning/phases/04-jobs-reliability/04-SUMMARY.md` for the PO to see
  at the V2-04 gate (04-P14). Proposal and evidence: `.planning/phases/04-jobs-reliability/04-ADR0005-PROPOSALS.md`.
  Rejecting either amendment is a revert of its one ESLint zone and its call site.

### A2: request-path enqueue takes the active tenant only as a constraint (R-6, revised for the 03-07 D1 finding)

- **Context:** Decision 3 says the enqueue RPC "derives the tenant from `auth.uid()` and accepts no tenant argument".
  A user who is a member of two clinics has no single tenant derivable from `auth.uid()`, and until V2-05 adds a
  database-side active tenant nothing else stops a user acting in clinic A from enqueueing for clinic B.
- **Decision (replaces "accepts no tenant argument" in Decision 3):** request-path enqueue derives the tenant from the
  subject row. It takes the caller's active tenant (`ServiceContext.tenantId`, session-derived, never request input)
  only as a constraint the subject row must match, and requires membership in it; a mismatch reads as not found. It is
  never the source of the row's tenant.
- **Verification:** `public.enqueue_message` (migration 000035) and `public.enqueue_webhook_event` (000036); the
  dual-member cases of `tests/jobs/enqueue-message-rpc-db.spec.ts` and `tests/jobs/enqueue-webhook-rpc-db.spec.ts`
  and guard leg 3b; the "any membership" variant shown failing
  (`.planning/phases/04-jobs-reliability/evidence/04-03a|04-03b/negative-enqueue-any-membership.txt`).

### A3: the Send Email hook may record its delivery id through one system function (R-43)

- **Context:** Decision 2 lists `app/api/{jobs,webhooks}/**` but not `app/api/auth/**`. The Supabase Auth Send Email
  hook (`app/api/auth/send-email/route.ts`) is a Standard-Webhooks-signed server-to-server endpoint, an inbound webhook
  in all but path, and its retries can land on another server instance, which only a shared store can dedupe. An
  anon-callable dedupe RPC instead would let anyone fill the table.
- **Decision (an allow-list addition to Decision 2, not a register entry):** `app/api/auth/send-email/route.ts` may
  import `features/auth/system.ts` and call it only after the signature check, only to record the delivery id
  (reason `auth.send_email_hook`): `authHookDeliveryBegin` / `authHookDeliveryFinish` →
  `public.inbound_webhook_begin/finish('supabase_auth_hook', <webhook-id>)` (service role only, migration 000037).
  Provider, id and timestamps only; a store error never blocks an auth email. No other `features/*/system` module and
  not the factory itself may be imported there.
- **Verification:** one ESLint zone for exactly that route with a pass fixture and fail fixtures (the same import from
  another `app/api/auth/**` route and from a feature service; the factory, another domain's system module and
  `features/sharing/system` at the route) in `tests/security/p1-34-lint-gates.spec.ts`;
  `tests/integration/auth/send-email-hook-dedupe-db.spec.ts`; `REASON_OWNER["auth.send_email_hook"] =
  "features/auth/system"`.

**Register state after V2-04 (Verification 4):** the V2-04 entries (`app/api/cron/**`, `lib/messaging/dispatcher.ts`,
`lib/webhooks/**`) are deleted; the register holds only `app/api/v1/**` and `lib/api/**` (owner P1-37), as this
ADR's end state requires. No amendment is needed for that.
