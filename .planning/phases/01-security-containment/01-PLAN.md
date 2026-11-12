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

## Rulings on the briefs' open questions (agent acting as CTO, PO delegated 2026-11-11; PO confirms at gate)
| # | Question (brief) | Ruling | Why |
|---|---|---|---|
| R1 | 01-06 Q1 signups off locally until AUTH-07 | **Yes**: `config.toml` `[auth] enable_signup = false` (supersedes D4). Seeds use `admin.createUser`, unaffected. `/otp` magiclink login for existing users stays an accepted residual until the V2-03 Send Email hook | Default deny: no app path creates users before V2-13b, so the API path should not either |
| R2 | 01-06 Q2 recovery template | Confirms D2: code-only `supabase/templates/recovery.html` + `[auth.email.template.recovery]` | Flow needs `{{ .Token }}`; minimal pull-forward of AUTH-02 |
| R3 | 01-06 Q3 non-prod invite link | Confirms D3: deleted | Token leak; seeds cover dev |
| R4 | 01-06 Q4 `/join` | (ii) sign-in-to-accept, no `next`; "open the link again after signing in" | Keeps AUTH-04b scope (safe-next) intact |
| R5 | 01-06 Q5 login copy for new clinics | "Access is by invitation from your clinic." No contact link | No signup until V2-13b; no unverified contact channel |
| R6 | 01-06 Q6 ABDM claims in showcase panel | **Strip** all unverified ABDM/compliance claims | Unverified regulatory claims are a legal and trust risk |
| R7 | 01-06 Q7 local dev seed | Deferred to V2-02 (P1-27 e2e owns it) | Tests seed their own users |
| R8 | 01-06 Q8 360px/axe | Deferred to V2-02 (Playwright + axe); pages use semantic labels | No browser harness until V2-02 |
| R9 | 01-02 C3 invite email binding | Leave to AUTH-06 (= D10) | Roadmap placement |
| R10 | 01-05 C7 doctor rule on API completion | 409 `VISIT_LOCKED` only; doctor rule deferred to P1-37 | `/api/v1` is off by default |
| R11 | 01-05 C11 signed Rx via API PATCH | Out of V2-01 (P1-03) | Roadmap placement |
| R12 | 01-01 C3 required `ctx` (with `ctx.db`) on `server-only` services | **Compliant**: D1 bans caller-chosen acting principals on `"use server"` exports and on modules that can *switch* to the service role. A `server-only` service taking a required context built only by `requireServiceContext()` (actions/RSC) or by v1 register routes is the "explicit context" ADR D1 names. The AST rule targets `"use server"` modules and the non-action D1 list | ADR D1 last sentence |
| R13 | 01-01 R6 optional `clientOverride` on register modules | Removed. Register modules export functions taking a **required** `db` first argument; the single entry point that builds the service-role client lives in the route/cron handler (register path). No optional overrides anywhere | "All `*Override` parameters are removed" |
| R14 | 01-01 R3 RLS hides rows the DPDP/outbox paths need | Do not weaken tests. If a legitimate owner operation is blocked by RLS on the user client, add a narrowly scoped SECURITY DEFINER RPC in a new migration (tenant from `auth.uid()` membership + permission check inside, `REVOKE … FROM anon, public`), never a service-role fallback | ADR D3 pattern; "never falls back" |
| R15 | 01-01 R9 referral clinic names, storage-provider SR fallback | Stay on the ADR register until V2-03 (P1-34) unless they are override seams; SR fallback in `features/notifications/triggers.ts` removed now | Keeps 01-01 bounded; ADR allows "by V2-03" |
| R16 | 01-01 C2 size | Split into 01-01a (infra, audit, generators, staff/terminology/patients/consent/notifications/labs/referrals), 01-01b (visits/scheduling/waitlist/queue/settings), 01-01c (prescriptions/consultation/billing/api-keys/webhooks/dpdp/appointments→system/v1 routes), 01-01d (AST lint rule + fixture, inventory tool, regression tests TC-SA-*). Suite green + commit after each | Reviewable increments |
| R17 | 01-01 C8 test run form | Local lane (`npx vitest run` with the loopback guard; stack started with `npm run test:db` excludes) is the approved form since V2-01a | Guard enforces 127.0.0.1 |

## Follow-ups carried from 01-01a (assigned)
- F1 (01-01c): receipt PDF route builds `.or(id.eq.${…})` from the URL id (SEC-20 pattern) → validate uuid / use `.eq`.
- F2 (01-01c): consent toggle copies the free-text note into audit metadata `reason` (possible PHI) → store a fixed reason code, not free text.
- F3 (01-01c): prescription and receipt PDF routes require membership only → require `prescriptions:read` / billing read permission.
- F4 (V2-05 P1-01 permissions matrix): staff-directory and notification actions require membership only (unchanged from v1); record, do not widen 01-01.
- F5 (01-01c): remove `recordAuditLegacy` and `legacyServiceContext` once the last domain moves.
- F6 (01-01c): `saveConsultationDraft` accepts caller-chosen `vitals.recorded_by` → strip/overwrite with `ctx.userId`.
- F7 (01-01c, ruling): `deleteScheduleBlock` requires the same permission as create (`clinic:manage`); receptionists cannot delete clinic-wide blocks they cannot create.
- F8 (01-01c, ruling): `checkSlotAvailability` fails closed (`available:false`) on any unexpected DB error; double-booking risk outweighs a false "unavailable".
- F9 (ruling, 01-01c): PDF routes gate on the matching in-app permission (Rx PDF `consultations:view`, receipt PDF `appointments:view`). Receptionists/admins lose the Rx PDF link (least privilege for clinical data); the UI hides the link for roles without the permission instead of showing a 403 link. Whether front desk may print Rx (common in Indian clinics) is decided in the V2-05 P1-01 permission matrix.
- F10 (ruling): request-path webhook enqueue runs on the user client; RLS (owner/admin) drops events from doctor actions. Owned by V2-04 (ADR D3 SECURITY DEFINER enqueue RPC) — add "doctor action enqueues a webhook event" to V2-04 acceptance. Acceptable now: no live integrations, `/api/v1` off by default.
- F11 (ruling): amendment reason (reopen/finalize) and schedule-block reason stay in audit metadata — an amendment reason is a medico-legal audit requirement; `audit_logs` is tenant-scoped PHI-grade storage. Consent/erasure free text was moved out because the record itself holds it.
- F12: v1 PATCH ignores blocks/off-duty, v1 inline service-role queries → P1-37 (behind `API_V1_ENABLED`, default off).
- F13: tenant-A user can insert a consent row (tenant A) referencing tenant B's patient id — no composite `(tenant_id,id)` FK (DB-01). Owned by V2-05 P1-02; no B data written or read.
- F14: the AST lint rule sees inline param types only; the type-aware inventory (`scripts/inventory-server-actions.ts`, exits 1 on a flag) must run in CI → V2-02 CI job.
- F15 (ruling, ADR-0005 amendment A1 drafted in phase docs): public token routes (`app/api/r/[token]`, `app/r/[token]`, `app/api/reports/view`, `app/reports/view`, `app/api/reschedule/[token]`) may import `features/sharing/system.ts`, which only signs storage objects under the token's tenant (path checked) after an anon token-scoped RPC resolved the token. V2-03 `no-restricted-imports` must encode this importer list.
- F16: reschedule slot computation still in UTC (C10) → P1 (V2-08 front desk).
- F17 (ruling): share-token values are stored raw and readable by every tenant member (SELECT policy). Target: store only a SHA-256 hash (like invitations), return the raw token once at creation → V2-05 (with P1-01 `has_permission`).
- F18: sign-off is not one transaction (visit completed first, Rx update may fail after) → P1-05 atomic server commands (V2-07). Lab path DB check constraint on `patient_documents` deferred with the DPDP test fixture update (V2-05).
- F19 (fixed in 01-05): middleware matcher skipped `/api/v1/*.png|svg|…` so the switch could be bypassed; matcher now includes `/api/v1/:path*`.
- F20 (ruling, P0-06): next 15.5.27 → 15.5.28 (latest 15.5.x ≥2 weeks old; 15.5.29 is 9 days old). Bundled postcss 8.4.31 advisories (sourceMappingURL read, `</style>` XSS) need attacker-controlled CSS/source maps at build time — not our threat model. Accepted; no `overrides` (forcing a dependency Next pins is riskier). Revisit at the Next 16 upgrade / V2-14 dependency audit. AI SDK / jsondiffpatch / zod 3 audit hits → P1-19 (V2-12).

## Review triage (reviews/review-independent.md = IR, reviews/review-adversarial.md = AR)
Fix in V2-01 (plan 01-08 review fixes): AR-M1 referral path substitution; IR-M2/AR-M2 `create_share_token` role-per-type + audit in DB + `revoke_share_token`; AR-L1 webhook sender = recipient + confirm only from booked states; AR-L2 reschedule horizon ≤90 days, double-booking check, newer token revokes older, bounded booked-times lookup; AR-L3 slot length/schedule bounds (zod + DB CHECK); AR-L4 credential columns editable by self or owner only; AR-L5 lab/referral audit drops token/phone; AR-L6 local `otp_expiry=600`, `minimum_password_length=10` (pulled forward from AUTH-02); AR-Info signed consultation overwrite via draft save → refuse; IR-L1/L2 no `error.message` to clients (generic messages, server log without PHI); IR-L3 profile update before role change; IR-L4 `search_medicines` resolves pg_trgm in `extensions` or `public`; IR-M1 tool-generated before/after evidence.
Deferred: AR-L7 R2 bucket-wide signing → P1-43 (R2 unset); AR-L2 doctor hours/blocks on reschedule → V2-08 with F16; AR-Info any user can create a clinic → V2-13b (AD-3); AR-Info raw DB errors in logs → V2-03 logging; AR-Info broad table grants → V2-05 P1-01.

## Review round 2 triage (reviews/review2-independent.md = IR2, reviews/review2-adversarial.md = AR2)
Fix in V2-01 (plan 01-09):
- AR2-H1: storage paths — strict charset `[A-Za-z0-9_./-]`, no `%`, no `..`/`.` segments, in DB (share resolver + CHECK constraints on stored path columns, incl. the deferred `patient_documents.storage_path` CHECK; update the DPDP fixture) and app (`signSharedObject` uses `isWellFormedStorageKey`); prescription share path derived, not trusted.
- AR2-H2: `/api/v1` switch — middleware normalises (decode repeatedly; 404 any `/api` path that contains `%` or a backslash after normalisation if not decodable) and `apiV1Enabled()` checked again in `authenticateApiKey` and in the `docs` / `openapi.json` handlers.
- AR2-L1 (supersedes F17 deferral): share tokens stored as SHA-256 hashes; raw token returned once at creation; resolve by hash; members cannot read raw tokens.
- AR2-L2: queue transitions cannot move a completed/signed visit back to `in_consultation` (only the amendment flow can).
- AR2-L3: webhook sender match on full E.164 (country code included).
- AR2-L4: WhatsApp cancel/reschedule act only on `booked`/`confirmed` visits.
- AR2-L5: `deleteLabDocument` applies the patient-path check; audit drops `storage_path`.
- AR2-Info: reschedule refuses visits with NULL `doctor_id` (lock); the new v1 line returning DB error text → fixed message.
- IR2-L1: Sign & Bill retry after partial failure continues to billing (idempotent on an already-signed visit by the same flow).
- IR2-L3: 000021 cleans out-of-range slot lengths / malformed schedules before its CHECKs (edit of 000021 allowed: never pushed, applied only to the local stack — recorded exception).
- IR2-L4: admin attempt to change/clear credentials returns an explicit refusal; IR-L3 test added.
- IR2-Info: `search_medicines` schema-resolution proven by a SQL check script run in a rolled-back transaction (output → evidence).
Deferred: AR2-Info staff bookings outside the reschedule lock → V2-08; ~94 legacy `error.message` returns → V2-03; `otp_expiry` assertion is config inspection only.
- F21 (ruling, 01-09): in-app DPDP export no longer goes through `/api/v1` (it was 404 since the switch defaulted off) — session route `app/api/patients/[id]/export`. Staff DPDP export requires `exports:create` (owner only; was `patients:view` = every role → bulk-exfiltration path). V2-05 P1-01 may widen to admin.

## Review round 3 triage (reviews/review3-adversarial.md = AR3): H1, H2 CLOSED; L2–L5 closed
Fix in V2-01 (plan 01-10): AR3-N1 (keeps AR2-L1 open) — share links/tokens in `communication_queue`: members get no read on message payload columns (column-level grants; status/metadata needed by UI only), no member UPDATE/DELETE on the queue (dispatch runs on the system path), tokens never in metadata, payload links scrubbed after send/failure-final. AR3-N2 — one live invoice per visit: partial unique index (excluding void/cancelled), Sign & Bill retry/double-submit returns the existing invoice, no duplicate payment. AR3-N3 — webhook sender must carry the country code (no bare 10-digit match).
Record only: AR3-Info member can repoint a share link to another patient of the same tenant via direct row edits, and `exports:create` limits only the one-click export, not data access → V2-05 (P1-01/P1-02 and clinical immutability P1-03).
- F22 (ruling, 01-10): request paths now dispatch only the row they enqueued; retries depend on `/api/cron/dispatch-communications`, which nothing schedules yet → V2-04 go-live blocker (jobs runner + schedule).
