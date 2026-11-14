# 05a Review triage (V2-05a)

Reviewed commit `8bda1c6`. Three fresh reviewers; reports in `reviews/`: `v205a-review-independent.md` (IND),
`v205a-review-adversarial-rls.md` (RLS), `v205a-review-adversarial-integrity.md` (INT). Triage by the orchestrator acting
as CTO (PO delegated rulings 2026-11-13).

Rules: every fix has a regression test that fails without it (pgTAP or Vitest, proven against the pre-fix tree); every
High and Medium gets a fresh re-verification; accepted items carry a reason and an owner. Common root cause: row
policies are right, but table-wide UPDATE grants let a role write columns that belong to another role or to an RPC.
The fix pattern is column-level grants plus guard triggers that bind actor columns to `auth.uid()`.

Fix plans and migrations: 05-11a = 000068–000070 (visits and clinical integrity), 05-11b = 000071–000074 (credentials,
billing, notices, audit, referrals), 05-11c = application only, no migrations.

## High (fix + re-verify)

| ID | Source | Finding | Fix | Plan |
|---|---|---|---|---|
| H-VISIT | INT H-1, RLS M-3, IND M1 | Any `appointments:edit` holder can move a signed visit (with its notes) to another patient, forge `signed_by` (any auth user), un-sign and reopen it; no audit or amendment row | Guard trigger on `visits`: `patient_id` immutable after insert; `signed_at`/`signed_by` settable only by `consultations:edit` holders and only to `auth.uid()`; a signed visit's status/doctor change only via the amendment path; `signed_by` must be a clinic member | 05-11a |
| H-INVITE | RLS H-1 | Admins can read the pending owner invitation's `token_hash`; `consume_invitation` accepts it without checking the invited email → any account the admin controls becomes owner | Brought forward from 05-07a (minimal): `token_hash` not selectable by `authenticated` (column grants); `consume_invitation` requires the caller's confirmed email to equal the invited email. 05-07a still delivers invitations v2 | 05-11b |

## Medium (fix)

| ID | Source | Decision | Plan |
|---|---|---|---|
| M-ACTOR | RLS M-3, IND L2 | Actor columns bound to the caller: consent `given_by`/recorded-by, amendment author, referral `referring_doctor_id`, prescription `doctor_id` (= caller, or caller holds `consultations:edit` and the doctor is a clinic doctor only on create by the visit's doctor) | 05-11a (visits, prescriptions, amendments), 05-11b (consents, referrals) |
| M-SIGNED | INT M-3, IND Info vitals | Writes to `clinical_notes` and vitals of a signed visit are refused unless the visit is reopened through the amendment path (amendment row written). Full immutability stays V2-09a | 05-11a |
| M-DURATION | INT M-1, IND L1 | `estimated_duration_minutes` CHECK 5–480 (NOT VALID, diagnostic + clamp of legacy rows, VALIDATE); v1 API and app schemas use the same bounds | 05-11a (DB), 05-11c (zod) |
| M-TOKEN | INT M-2 | Members cannot write `token_number`; only `next_queue_token` assigns it (column grants); range CHECK. A repeat check-in of the same visit reuses its token (INT Info) | 05-11a |
| M-INVOICE | IND M2, RLS L-1 | Invoice totals/status/paid fields not writable by `authenticated`; paying goes through `record_payment` (`billing:collect`, payment row, audit, outbox). Direct `payments` insert revoked (IND Info). A doctor cannot reassign a visit's `doctor_id` (front-desk `appointments:edit` only, and never on a signed visit) | 05-11b (billing), 05-11a (doctor_id) |
| M-NOTICE | RLS M-2, IND M3 | `authenticated` may update only the read/dismiss columns of notices addressed to it; broadcast/role notice content is written only by definer paths | 05-11b |
| M-APIKEY | RLS M-1, IND M4, INT L-6 | `api_keys`: `authenticated` may update only `name` and set `revoked_at` (never clear it); `key_hash`, `created_by`, `tenant_id` immutable; scope guard covers every path; DELETE revoked (revoke only), so audit attribution survives | 05-11b |
| M-APINOTES | IND M5, RLS L-2 | `/api/v1/visits/*` no longer embeds or writes `clinical_notes` (R-9: admins, who create keys, hold no clinical access). Clinical API scope is a P1-37 decision | 05-11c |

## Lows fixed in 05a

- 05-11a: none beyond the above.
- 05-11b: `log_audit` accepts only an allow-list of client actions, refuses reserved prefixes (`dpdp.`, `auth.`, `billing.`, `ops.`) and caps metadata (INT L-5); `referrals.target_doctor_id` must be a doctor of the target clinic (RLS L-3); consent covers every clinical field sent to the target clinic, not only the history snapshot (IND L6); template `request_roles` updated for the new templates (IND L4).
- 05-11c: one shared deadlock-retry helper (40P01 once) used by `createVisit`, the v1 visits and appointments routes and the reschedule path (INT L-3, 05-08 open item); every `/api/v1` route returns fixed error texts (INT L-4, IND L8); DPDP export fails closed on any query error and audits exactly once (INT L-1); the referral consent write is checked and the referral fails if it fails (IND L7); revoked-session page loads redirect to sign-in instead of raising "Unauthenticated" into the error sink (wave notes, 05-02a).

## Accepted (reason, owner)

| Item | Reason | Owner |
|---|---|---|
| INT L-2 / IND Info: v1 PATCH visit + notes not atomic | `/api/v1` off in every deployed tier (PO-16); 05-11c removes the notes write from v1 entirely | P1-37 |
| INT L-7: storage UPDATE/DELETE tampering inside a clinic | Documented R-23 deferral; versioned immutable keys come with the Rx rebuild | V2-09a / V2-09c |
| INT L-8: legacy lab object names > 255 chars | No v1 objects reach v2 storage until the production migration; a diagnostic query is added to the go-live migration checklist | V2-15 |
| IND L3: 000053 adds the blocking CHECK with the backfill | No production v2 deploy yet; staging migrates with its own app deploy. Expand/contract enforced from here on | — (ruling) |
| RLS L-5: lookalike clinic listing in the referral directory | Ruling (CTO): a directory listing becomes visible only after platform verification; the flag and the platform-admin control ship with the V2-11 referrals UI, and the directory UI stays off until then | V2-11 |
| INT Info: doctor memberships use RESTRICT | Staff are deactivated, never deleted (V2 staff management); revisit if hard delete is ever needed | V2-05b 05-05 |
| IND Info: 000059 revokes PUBLIC execute in every schema | Intended; documented in the 05-02c record | — |
| pgTAP gate `FLOOR` / `REQUIRED_FILES` | Raised at the 05a gate close (before the evidence run) | 05a gate |

## Fix-plan deviations (CTO, 2026-11-14)

Approved: 05-11c v1 PATCH refuses `status: "completed"` (completing signs the visit; keys hold no clinical access);
lookups report a database failure as an error, not 404; the second-deadlock spec expects the taken slot; referral
consent failure withdraws the referral (single transaction via RPC in V2-11). 05-11a: prescriber = caller (strict);
doctor reassignment refused for doctors only. 05-11b: `record_payment` SECURITY DEFINER; scopes set at key creation
only; `reason_for_referral` not consent-gated; `dpdp.*` audit actions accepted only from their own paths.
Assigned: v1 `/prescriptions`, `/referrals`, `/lab-orders` clinical content → P1-37 (v1 off everywhere, PO-16);
shared read state of role/broadcast notices → V2-11; `link_url` CHECK VALIDATE → 05-b0; 000070 deploy order → 05-b0 runbook.
