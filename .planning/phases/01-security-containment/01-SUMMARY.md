---
phase: 01
roadmap_id: V2-01
name: Security containment on feature/v2
status: awaiting PO gate approval (G3-partial)
base_commit: b9d2ad5
head_commit: 60d8db0
---

# Phase 01 (V2-01) — summary

V2-01 removes the v1 backdoors from the v2 branch. Every item in the roadmap row (P0-01…P0-06, P1-23, AUTH-01,
AUTH-04a, AI-01) is delivered. Five review passes ran (2 independent, 3 adversarial; round 2 failed on two Highs, both
closed and re-verified in round 3); every "fix now" finding was fixed and regression-tested. Evidence is tool-generated (`evidence/`, script `scripts/phase-evidence.mjs`).
The PO delegated all gate-level decisions in this phase to the agent acting as CTO (2026-11-11). Every decision is in
`01-PLAN.md` (D1–D12, R1–R17, F1–F20, review triage) for the PO to confirm at the gate.

## What changed, by plan
| Plan | Requirement | Outcome |
|---|---|---|
| 01-07 | AI-01 | Both copilots, drawer, Cmd+K, mic, mock provider and `/api/ai/*` copilot routes deleted. Scribe and catch-up fail closed (no draft, no outbound call) unless a real provider is explicitly configured. |
| 01-03 | P0-03 | Messaging webhook accepts only `msg91` POST; secret from a header, constant-time compare; unknown provider 404, bad secret 401; replies routed only by `replyMsgId`; phone fallback deleted. 01-08: reply must come from the number we messaged; "confirm" only moves a booked visit. |
| 01-06 | AUTH-01, AUTH-04a | OTP login, dev OTP shortcut, dev auth logger, `/verify`, `/auth/callback`, social buttons, non-prod invite link and MSG91 staff-OTP template deleted. Password sign-in and two-step forgot-password (6-digit code, `verifyOtp` type `recovery`, `updateUser`, other sessions signed out). Fixed error strings only. `/join` = sign in to accept. Local auth: signups off, code-only recovery template, min password 10, OTP expiry 600 s. ESLint gates for OTP user creation. |
| 01-01a–d | P0-01 | All 24 `"use server"` modules (110 exports) authenticate first, derive tenant/actor from the session and call `server-only` services taking a `ServiceContext`. All `*Override` params removed; `notifyPrescriptionIssued` deleted; register modules take a required `db`; `features/appointments/system.ts`. AST lint gate with fixtures; type-aware inventory tool; unauthenticated forged-override sweep over every export; TC-SA-01..06/10/30 regressions. |
| 01-02 | P0-02 | Migration 000019: memberships writes revoked (column-limited profile UPDATE); `change_member_role` RPC (owner rules, last-owner guard, audit); owner/admin invites owner-only, `created_by` = caller; SECURITY DEFINER tenant checks; EXECUTE revoked from anon. |
| 01-04 | P0-04 | Migration 000020: share tokens read-only for members; `create_share_token` (tenant from resource); anon token-scoped resolve/consume RPCs bound to tenant + resource type; reschedule token fixed and single-use; public responses carry no internal ids; storage signing only in `features/sharing/system.ts` (ADR-0005 amendment A1). |
| 01-05 | P0-05, P0-06, P1-23, API switch | Lab path must be `tenants/<tenant>/patients/<patient>/…` (422 otherwise); `/api/v1` PATCH of completed/signed visit → 409 `VISIT_LOCKED` (also in the UPDATE filter); sign-off refuses re-sign and checks every write; `API_V1_ENABLED` (default off → 404 for all `/api/v1/**`, refused in production; matcher bypass via image extensions fixed); Next 15.5.27 → 15.5.28. |
| 01-09 | Round-2 fixes | Migration 000022/000023: strict storage-key charset in DB CHECKs + app (closes encoded-`..` cross-tenant signing); `/api/v1` switch normalises encoded paths and is re-checked in every v1 handler; share tokens stored as SHA-256 only; queue cannot move signed visits; full-E.164 sender match; late WhatsApp cancel/reschedule only on booked/confirmed; Sign & Bill retry; staff DPDP export via a session route, owner-only (`exports:create`). |
| 01-10 | Round-3 fixes | Migration 000024: members cannot read/edit message-queue payloads, links scrubbed after send; one live invoice per visit (no duplicate invoice/payment on double submit); sender must carry the country code; failed-delivery reports persist; no patient phone in audit rows. |
| 01-08 | Review fixes | Migration 000021 + app: share links sign only the resource's own file (referral path derived; receiving clinic may only acknowledge); share-token role per type + DB audit + `revoke_share_token`; reschedule ≤ 90 days, no double booking, newer link revokes older; slot/schedule bounds (zod + DB CHECK); credentials editable by self or owner only; signed consultation cannot be overwritten by a draft save (amendment still works); no raw DB error text to clients; `search_medicines` works with pg_trgm in `extensions`; lab/referral audits carry no token/phone. |

## Defects found and fixed beyond the roadmap list
- Any member could set their own role to owner; an admin could demote the sole owner (01-02).
- A member could mint a share link to another clinic's prescription; reschedule links never worked (nil-uuid
  `created_by`); two concurrent reschedules both succeeded (01-04).
- `/api/v1` switch bypass via paths ending in image extensions (01-05).
- Sharing a referral letter over WhatsApp always failed against a real database (ambiguous PostgREST join hidden by a
  mocked test) (01-08).
- Slot availability failed open; unauthenticated visits register looked like "no visits"; vitals and drafts accepted a
  caller-chosen `recorded_by` (01-01).

## Retired specs (deleted only where the approved docs retire the feature)
`tests/ai/clinical-copilot.spec.ts`, `tests/ai/operations-copilot-ui.spec.ts`, `tests/ai/evals/*` (5 regex "evals"),
`tests/security/ai-rbac.spec.ts` (AI-01, AI §11.2, TEST_STRATEGY §2.6 erratum); `tests/security/dev-logger-lockout.spec.ts`
(AUTH-01; its production invite-token guard moved to `tests/security/invite-token-lockout.spec.ts`).

## Numbers
Before (`1491899`, `evidence/baseline-1491899/`): 71 files / 700 tests. After (`60d8db0`): 86 files / 1128 tests, two
consecutive full runs green, 0 skipped (`evidence/summary.json`). Migrations 000019–000024.

## Deferred, with owner (details in 01-PLAN.md)
Webhook enqueue from doctor actions (F10 → V2-04) · consent row may reference another tenant's patient id (F13 → V2-05
P1-02) · inventory script in CI (F14 → V2-02) · reschedule hours/blocks and UTC (F16 → V2-08) · atomic sign-off (F18 → V2-07 P1-05) · postcss advisory accepted (F20) · front-desk Rx printing (F9 → V2-05
P1-01) · R2 bucket-wide signing (P1-43) · clinic creation by any signed-in user (V2-13b) · DB error text in server logs
(V2-03) · `/api/v1` inline service-role queries (F12 → P1-37) · dispatch cron schedule (F22 → V2-04 go-live
blocker) · same-tenant share-link repointing and export-permission scope (AR3 info → V2-05).

## Open for the PO
0. **The GitHub repo `thecliniqai/cliniqai-app` is PUBLIC.** No patient data is in it, but security docs and review
   reports describe defences and deferred weaknesses. Make it private before go-live (recommended now).
1. Confirm the delegated decisions (D1–D12, R1–R17, F-rulings, review triage) and ADR-0005 amendment A1.
2. Hosted Supabase must get the same auth settings as `supabase/config.toml` (signups off, code-only recovery
   template, min password 10, OTP expiry 600) — config as code lands with AUTH-02 (V2-03).
3. MSG91 console: send the secret in the `x-webhook-secret` header (remove `?secret=` from the URL; rotate the secret
   if it was ever logged).
4. Still open from earlier phases: CLAUDE.md "Commands" text (agent edit blocked), AUTH-00 A00-1…5 rulings before V2-03.
