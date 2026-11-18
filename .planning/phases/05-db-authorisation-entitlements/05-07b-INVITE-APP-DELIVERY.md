---
phase: 05
plan: 05-07b
part: 05b (wave 7)
subsystem: AUTH-06 app paths (email.invite handler, resend/revoke actions, /join, invite acceptance, server-side Turnstile) and the exactly-one-email proof
status: complete (local)
migrations: [000089_invitation_accept_context]
plan_head_before: 7c08c11
commits: [5f81f67, 0e3c895, docs commit]
code_head_after: 0e3c895
requirements: [AUTH-06 (backend complete), AUTH-D1, SEC-08, R-30, R-44 (ADR-0005 A4, proposed), R-46]
acceptance: [10 "one invite sends exactly one email under retry" (full, local Mailpit)]
---

# 05-07b record: invite app paths and exactly-one-email delivery

**Outcome:** done locally. 05-07a's database half now has its app half:
- the `email.invite` job handler mints the token at send time and sends one link-only `staff-invite` email through
  `getEmailSender()` (Mailpit locally);
- `resendInvite` / `revokeInvite` server actions;
- `/join` renders from `peek_invitation` (no side effect) with a minimal functional set-password form;
- invite acceptance for a new invitee is a public, token-gated action. It checks Turnstile server-side (new), the
  password policy and FT-05, then reaches the Auth admin API through the proposed ADR-0005 amendment A4;
- **acceptance 10 is proven against the local Mailpit:** 5 parallel runner passes and a transport failure on the
  first attempt each leave exactly one message.

One migration, `000089_invitation_accept_context` (a service-role lookup the system path needs). pgTAP 42 files /
4609, full Vitest 254 files / 4995 and the e2e PR lane 228 passed, all with 0 retries. Nothing hosted was contacted;
no real email was sent.

## What shipped

| Area | Contents | Plan item |
|---|---|---|
| `lib/jobs/internal/handlers/email-invite.ts` + registry | Kind `email.invite` (payload `{invitation_id, token_version}`, strict zod). Reads the invitation with the service role; consumed, revoked, expired or another version → done, nothing sent; `invitation_issue_token(id, version)` → `null` → done; else `send({ to, subject, html, text, tag: "staff-invite" }, { signal })`. `EmailSendError` → retry with its safe code; `EmailDisabledError` / `EMAIL_PROVIDER=disabled` → dead `email_disabled`; config error → dead. No idempotency key (each attempt carries a new token; a replayed key would deliver a dead link). Registered in `PRODUCTION_HANDLERS`, so the runner now claims the kind (05-07a's pending jobs start sending) | handler |
| `lib/email/templates/invite.ts`, `lib/email/types.ts` | Link-only message: clinic name (one line, ≤ 120 chars, escaped), role label, `<NEXT_PUBLIC_APP_URL>/join?token=…`, expiry in IST. `EmailTag` gains `"staff-invite"` | handler |
| `features/staff/actions.ts` | `resendInvite({ invitationId })`, `revokeInvite({ invitationId })` (`resolveServiceContext("staff:invite")`, then the 05-07a RPCs, which bind the row to the active clinic; fixed texts per reason). `acceptInvite` delegates to `features/auth/invite-flows.ts` (same manifest entry, now refuses a malformed token after authentication) | actions |
| `features/auth/invite-flows.ts` (A4 module) | `acceptInviteWithPassword({ token, password, turnstileToken })`, in this order: token shape → SHA-256; `verifyTurnstile` (unset secret refuses, never skips); password policy; `isPwnedPassword`; only then `redeemInvitationWithPassword` (system path). `acceptInvite(token)`: signed-in path → `consume_invitation`. Fixed catalogue texts only (`messages/en.ts` `auth.invite`) | invite-flows |
| `features/auth/system.ts` | `redeemInvitationWithPassword(hash, password)` (reason `auth.invite_accept` → `features/auth/system`): `invitation_accept_context` → no account: `admin.createUser({ email: <the invited address>, password, email_confirm: true })`; unconfirmed: `admin.updateUserById(id, { password, email_confirm: true })`; **confirmed: refused** (`account_exists`, never overwritten); then `consume_invitation_for(user, hash)`. Logs a fixed event, the step and `errorTag` only | system |
| `features/auth/actions.ts` | `acceptInviteWithPasswordAction` (public, token-gated; manifest kind `{ publicToken }`) | action |
| Migration `000089_invitation_accept_context` | `public.invitation_accept_context(hash) → jsonb`, SECURITY DEFINER, `search_path ''`, **service_role only** + the R-38 session-role rule (`SYSTEM_ONLY` with a leaked grant). Not-pending → `{status}` only; pending → `{status, invited_address, user_id, email_confirmed}`; deleted accounts ignored; two live accounts → P0001 `INVITATION_ACCOUNT_AMBIGUOUS` (registered). Needed because the Auth admin API cannot look an account up by address and `auth.users` is not on the Data API | Rule 3 (see deviations) |
| `lib/auth/turnstile.ts` (R-46) | `verifyTurnstile(token, opts)`: form POST to the fixed siteverify URL (or the loopback override), 3 s deadline, `success === true` and hostname = the app's host (skipped only for Cloudflare's test secrets, which the env schema allows in local tiers only). Failures `unconfigured`, `missing_token`, `rejected`, `hostname_mismatch`, `unavailable`, `timeout`; the log carries the reason and Cloudflare's error codes only | Turnstile |
| Env (R-15 checklist) | `TURNSTILE_SECRET_KEY`: required in production; staging optional (05-P7); a Cloudflare test secret refused in staging/production; only test secrets in development/test/e2e/ci; secret-key shape. `TURNSTILE_VERIFY_URL`: test/e2e only, loopback only. `ENV_DOCS` + `.env.example` regenerated; test-lane guard (secret unset or a test secret, never echoed; the URL loopback); e2e app server: always-pass test secret + the fake siteverify that global setup starts on 127.0.0.1:3102 (`tests/e2e/support/turnstile-verify-server.ts`). Test secrets are built at run time (`turnstileTestSecretKeys()`) | Turnstile |
| `app/(auth)/join/page.tsx`, `join-forms.tsx` | Server page: hashes the token, `peek_invitation` → not valid / expired / withdrawn / used texts; pending → clinic, role, masked address; signed in → "Accept invitation"; signed out → set-password form (Turnstile widget) + "Sign in". Styled page and J-A2 stay V2-11's (R-31) | /join |
| ESLint A4 zone | `features/auth/invite-flows.ts` may import `features/auth/system` and nothing else on the service role (`A4_AUTH_ONLY`); pass and fail fixtures; the P1-34 counters test lists it as a feature_system importer, never a factory importer. Proposal: `05-ADR0005-A4-PROPOSAL.md` (applied to the ADR after 05-P1) | A4 |
| Guard manifest | New kind `{ publicToken }` (engine: leg 1 accepts its own fixed refusal text but still requires refusal and no request-client access; leg 3 runs as the outsider); `resendInvite`, `revokeInvite` = `staff:invite` (control exempt: the guard world holds no invitation; covered by invitations_v2 and invite-delivery) | manifest |
| Gates | pgTAP: `invitation_accept_context` required, `FLOOR` 4592 → **4609** (42 files). Vitest `REQUIRED_FILES` gains `tests/integration/auth/remove-member.spec.ts` (05-05 handover) and the four new specs; the Vitest floor stays 4633 (05a close; the 05b gate re-measures) | gates |

## Tests that fail without the change

| Spec | Cases | Without (evidence) | With |
|---|---|---|---|
| `tests/integration/auth/invite-delivery.spec.ts` (acceptance 10; Mailpit HTTP API) | 5 | handler not registered (the 05-07a state): (ii), (iii), (iv) fail, no message is ever sent (`vitest-mutant-handler-unregistered.txt`) | 5/5 |
| `tests/jobs/email-invite-handler.spec.ts` | 5 | handler minting for the invitation's current version instead of the job's: the stale-v1 case sends (`vitest-mutant-handler-any-version.txt`) | 5/5 |
| `tests/integration/auth/accept-invite.spec.ts` | 9 | no Turnstile check: 2 fail; Pwned check after the account change: 3 fail; confirmed accounts overwritten: 1 fails; unset secret skipping the check: 1 fails | 9/9 |
| `tests/auth/turnstile-verify.spec.ts` | 10 | fail-open on timeout/unavailable: 3 fail; skip when the secret is unset: 1 fails | 10/10 |
| `supabase/tests/database/invitation_accept_context.test.sql` | 17 | without the function: "planned 17 ran 0", and `definer_functions` 2 fail; with the R-38 rule replaced by `current_user`: the leaked-grant case fails | 17/17 |
| `tests/security/p1-34-lint-gates.spec.ts` (+8 cases) | pass `features/auth/invite-flows.ts`, fail from `features/staff/actions.ts`, `features/auth/actions.ts`, factory/other domain/sharing at the A4 module | without the zone `eslint features/auth/invite-flows.ts` reports 1 P1-34 error (`eslint-without-a4-zone.txt`) | pass |
| `tests/config/env-schema.spec.ts` (+7), `env-boot.spec.ts` (+1), `test-env-guard.spec.ts` (+1) | production without the secret, a test secret in staging/production, a real secret in local tiers, a non-loopback/forbidden `TURNSTILE_VERIFY_URL`, the e2e server's values; the guard never echoes the secret | the names did not exist | pass |
| `tests/e2e/auth/join-invite.spec.ts` (desktop + Pixel 7) | 3 | new | pending invitation and unknown token at 360/820/1280, axe 0 serious/critical, no horizontal scroll; one full acceptance through the e2e server (server-side Turnstile against the fake, FT-05, account created, invitation redeemed, the link then reads "used") |

`invite-delivery.spec.ts`, by case: (i) `inviteStaff` twice for one address (second in upper case) returns the same id
and leaves **one** job `invite:<id>:v1`; (ii) 5 parallel `runJobs` passes → **exactly one** `staff-invite` message for
the address, the job `done` after one attempt, `send_count = 1`, the delivered link peeks `pending`, a later pass sends
nothing; (iii) an `EmailSendError` on the first attempt → job pending with `synthetic_503`, no message; made due, the
second pass sends → **exactly one** message, two tokens minted, the delivered one is live; (iv) `resendInvite` → the
first link peeks `not_found` at once, three parallel passes → **exactly one more** message, the invitee's confirmed
account redeems the second link and not the first, nothing more is sent after consumption; plus a content case
(subject, recipient, role, IST expiry, no owner address, no storage URL, tag).

## Decisions and deviations

1. **Migration 000089 (Rule 3; the plan listed no migration for 05-07b).** The plan's system path needs the account
   that owns the invited address. The Auth admin API in supabase-js has no lookup by email, and `auth.users` is not
   exposed. A service-role-only definer function with the R-38 rule was the narrowest fix.
2. **One system function instead of `createInvitedUser` / `completeUnconfirmedInvitee` / `consumeInvitationFor`.**
   `redeemInvitationWithPassword(hash, password)` reads the address from the database and only then calls the admin
   API, so A4 exposes no general "create a user for any address" call. A confirmed account is never overwritten: the
   invitee signs in and accepts (plan: "a confirmed account → acceptInvite after sign-in").
3. **The account change comes before the redemption.** If the redemption then fails, the next attempt finds a
   confirmed account and the invitee accepts after signing in, so nothing is left stuck. A created account without a
   membership is possible only if the invitation is revoked in that gap; this is documented, not hidden.
4. **After a password acceptance the page says "Sign in".** The action does not sign the invitee in: the Turnstile
   token is single-use and is already spent by the server-side check, so GoTrue's own CAPTCHA (hosted) would refuse
   a sign-in that reused it.
5. **Hostname check skipped only for Cloudflare's test secrets.** Their dummy answers carry no real hostname, and the
   env schema allows them only in local tiers. Staging and production always check it.
6. **Residual window (research Pitfall 16).** The provider accepts the message, then the process dies before
   `complete_job`. The lease then expires and the retry sends a second message with a new token, so the first link is
   dead. No idempotency key is passed for this reason.
7. **`acceptInvite` now refuses a malformed token** (after authentication). A token that is not 64 hex characters
   was never minted.
8. **e2e: first PR-lane run 5 failed, fixed in the tests (`0e3c895`), 0 retries.**
   - The V2-01 a11y spec opened `/join?token=e2e-synthetic-token` and expected "Sign in". That encoded the old page.
     A never-minted token now reads as not valid.
   - The new join spec scanned before the hydrated submit button had faded in, and axe reported a transient
     color-contrast finding. It now waits for opacity 1, as the V2-01 auth specs do.
   - The full lane was then re-run green.

## Local evidence (tool output, `evidence/05b/05-07b/`)

| Check | Result | File |
|---|---|---|
| pgTAP lane + gate (db 000089, tree `5f81f67`) | 42 files, **4609/4609**; gate PASS (floor 4609, 42 required) | `pgtap-lane.tap`, `pgtap-report-gate.txt` |
| Full Vitest (tree `5f81f67`) | **254 files, 4995/4995**, 0 failed, 0 skipped; gate PASS (floor 4633, 160 required) | `vitest-summary.json`, `vitest-report-gate.txt` |
| e2e PR lane, fresh `e2e:build` at `5f81f67` | first run 223 passed, 5 failed (above), 0 flaky | `playwright-summary.json`, `e2e-pr-first-run-failures.txt` |
| e2e PR lane after the spec fix (`0e3c895`, same app build) | **228 passed, 9 skipped, 0 failed, 0 flaky, 0 retried** | `playwright-summary.json`, `e2e-pr-tail.txt`, `e2e-fix-targeted-tail.txt` |
| Vitest mutants (7) | each turns named cases red (table above) | `vitest-mutants-summary.txt`, `vitest-mutant-*.txt`, `vitest-mutants.py` |
| pgTAP without the function / R-38 mutant | planned 17 ran 0 (+ definer_functions 2 fail) / the leaked-grant case fails | `pgtap-without-000089-function.tap`, `pgtap-mutant-accept-context-current-user.tap`, `mutant-accept-context-current-user.sql` |
| Restore after the mutants | `schema-snapshot --check` PASS | `snapshot-check-after-mutants.txt` |
| ESLint without the A4 zone | 1 P1-34 error at `features/auth/invite-flows.ts` | `eslint-without-a4-zone.txt` |
| typecheck, `eslint --quiet`, inventory, `db:drift:local`, `schema-snapshot --check`, `authz:gen --check`, migration immutability (base `7c08c11`), `env-example --check` | all exit 0 / PASS | `static-checks.txt` |

**Shared stack.**
- One `supabase db reset --local` for 05-07b (2026-11-14T23:12:45Z, under the test-run lock), to apply 000089, followed
  by `npm run seed:local` (no `--reset`).
- One "without"/mutant run under the test-run lock: dropped and re-created `invitation_accept_context`, then
  replaced and restored its body from the migration text. `schema-snapshot --check` passed afterwards.
- Vitest mutants changed source files only, inside a test-run lock hold, and restored them by copy.
- e2e ran only under the e2e lane lock with :3100 free.

## Threats

- **T-05-27 (an invite link used by someone else):** unchanged at the database: redemption on both paths is bound to
  the invited address. The password path also creates or completes only the account that owns that address.
- **T-05-29 (account takeover through the invite path):**
  - a confirmed account is never overwritten;
  - Turnstile, the password policy and FT-05 run before any account change, proven by the specs and mutants;
  - the admin API is reachable only through one A4 function.
- **T-05-30 (duplicate emails under retry):** mitigated. The Mailpit proof is acceptance 10; the residual window is
  documented.
- **R-46:**
  - the server-side check fails closed in every failure mode;
  - the secret never reaches a log line or an error (spec + guard);
  - test secrets are refused in staging/production.
- New public surface:
  - `acceptInviteWithPasswordAction` (token-gated, manifest kind `publicToken`, legs 1 and 3 run);
  - `/join` GET (read-only `peek_invitation`).

## Open items

- **PO:**
  - 05-P1: confirm R-44 (ADR-0005 A4) and R-46; then apply A4's text to `docs/adr/0005-…`.
  - 05-P7: set `TURNSTILE_SECRET_KEY` on Vercel staging. Until then invite acceptance by password refuses there, by
    design.
- **05b gate:** re-measure the Vitest floor (rule: 95 % of the measured suite) and record the arithmetic.
- **V2-11:**
  - styled `/join` and journey J-A2;
  - invitation management UI (resend, revoke) on top of the new actions.
- **V2-13b / V2-14:** if Resend's idempotency is wanted for invites, it needs a token minted once per version and
  re-used across attempts (a different trade-off from R-30's "each attempt mints").
