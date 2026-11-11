---
phase: 01
roadmap_id: V2-01
name: Security containment on feature/v2
gate: G3-partial
requirements: [P0-01, P0-02, P0-03, P0-04, P0-05, P0-06, P1-23, AUTH-01, AUTH-04a, AI-01]
source: docs/v2/V2_MASTER_ROADMAP.md §12.2 (V2-01); docs/adr/0005-confine-service-role-client.md (Accepted)
briefs: research briefs per plan (session scratchpad), summarised here
---

# Phase 01 (V2-01): Security containment — plan

Objective (roadmap): the v2 branch never carries the backdoors. Scope, plans, acceptance and tests are fixed by
the roadmap; the PO directed execution without a separate discuss round (2026-11-11). Baseline before any change:
71 files / 700 tests green on the local stack at `1491899`.

## Execution order (dependency-driven, differs from roadmap numbering)
Deletions first so the override refactor does not rewire code that is about to go:
1. **01-07 AI-01** — delete both copilots, drawer, Cmd+K trigger, mic, mock provider, `/api/ai/*` copilot routes;
   scribe and catch-up fail closed (no draft, no regex/mock output, no outbound call) when no provider is set.
2. **01-03 P0-03 webhook lockdown** — only `msg91` accepted; every other provider (dev, twilio, gupshup, unknown)
   404; MSG91 secret from a header only, constant-time compare, bad/missing secret 401, no dev bypass; replies
   routed only by `replyMsgId` with `.eq`; phone fallback deleted; responses carry no ids/tokens/urls.
3. **01-06 AUTH-01 + AUTH-04a** — delete OTP login, dev shortcut, dev auth logger, verify page, auth callback,
   non-production invite-link return; password sign-in and forgot-password (code via `verifyOtp` type
   `recovery`, then `updateUser` + `signOut({scope:'others'})`); `/join` = sign in to accept (no `next`).
4. **01-01 P0-01 overrides → services** — ADR-0005 Decision 1: `"use server"` exports authenticate, check
   permission, derive tenant/actor from the session and call `server-only` services taking an explicit context;
   no `*Override`, no caller-chosen actor (incl. `recordVisitVitals.recorded_by`); action→action chains go through
   services with their own permission checks; `notifyPrescriptionIssued` deleted; ESLint rule (ADR Verification 3)
   with a fixture; tests rewired to services/contexts on the local stack; forged-override, cross-tenant and actor
   regression tests (SECURITY_VERIFICATION_PLAN TC-SA-*). Done domain by domain, suite green after each.
5. **01-02 P0-02** — migration: memberships table-level write REVOKE + column-limited profile UPDATE grant;
   `change_member_role` RPC (owner-only for owner/admin changes, last-owner guard); owner/admin invites
   owner-only and `created_by` = caller; SECURITY DEFINER tenant checks; `REVOKE EXECUTE … FROM anon` per function.
6. **01-04 P0-04** — migration: share tokens SELECT-only for members; `create_share_token` RPC (tenant from the
   resource row); token-scoped SECURITY DEFINER resolve/consume RPCs bound to tenant + `resource_type`
   (ADR-0005 Decision 3); reschedule token fixed and single-use; storage signing via `features/sharing/system.ts`.
7. **01-05** — P0-05 lab-orders zod + `tenants/<tenantId>/` prefix (422 otherwise); API PATCH guard: completed or
   signed visits → 409 `VISIT_LOCKED`, also in the UPDATE filter; P1-23 sign-off fixes; `/api/v1` behind
   `API_V1_ENABLED` (default off → 404 for all `/api/v1/**`; refused `true` in production env schema);
   **P0-06** Next.js bumped to the latest 15.5.x patch.

## Decisions taken by the agent (PO to confirm at the gate)
| # | Question | Decision | Why |
|---|---|---|---|
| D1 | New-clinic signup after OTP removal | None until V2-13b; owners only via seeds/tests | Roadmap places signup in V2-13b |
| D2 | Recovery email must carry a code | Add a local code-only recovery template (`supabase/templates/recovery.html` + config) | Forgot-password cannot work locally otherwise; hosted template is AUTH-03 (V2-03) |
| D3 | Non-production invite-link return | Deleted (AUTH_REDESIGN §6); staff without an account cannot join until AUTH-06 | Removes a token leak; big-bang go-live, no live clinics |
| D4 | `enable_signup` | Unchanged | Auth config as code is AUTH-02 (V2-03) |
| D5 | Webhook dev path | Deleted, not env-gated | Default deny; P0-03 allows "remove/env-gate" |
| D6 | Webhook error codes | Unknown provider 404, bad secret 401 | Roadmap acceptance "404 or 401" (security docs say 403) |
| D7 | AI SDK packages | Kept in package.json | Not named in AI-01; P1-19 (V2-12) owns them |
| D8 | `/api/v1` switch name | `API_V1_ENABLED`, default off | No doc names it (PO-16 default) |
| D9 | Reschedule token `created_by` | Nullable for system-issued tokens | Docs say "fix" without a target |
| D10 | Invite bound to invitee email | Not in V2-01 (AUTH-06) | Roadmap moved it |
| D11 | A00-1…A00-5 (AUTH-00) | Not blocking V2-01: app code no longer calls `/otp`; platform-side mitigation lands with CAPTCHA (V2-03) | PO ruling still needed before V2-03 |
| D12 | `server-only` in Vitest | Alias to Next's bundled empty module (no new dependency) | Avoids a dependency |

## Acceptance (roadmap, verbatim)
the grep/AST rule finds 0 override params; forged-override calls are rejected; a receptionist PATCH of `role` is
denied; `/api/webhooks/messaging/dev` returns 404 or 401; a cross-tenant token returns 404; a PATCH of a completed
visit through `/api/v1` is rejected; seeded users sign in by password and a normal login sends 0 emails (Mailpit);
grep finds 0 `shouldCreateUser`/`devOtp`; no `/api/ai/*` copilot route is reachable; the existing suites pass on
the local stack before and after.

Retired specs (copilot specs, regex "evals", dev-webhook and OTP tests) are deleted only where the approved docs
retire the feature (TEST_STRATEGY §2.6 erratum, AI §11.2, AUTH-01, P0-03); each deletion is listed in the summary.
