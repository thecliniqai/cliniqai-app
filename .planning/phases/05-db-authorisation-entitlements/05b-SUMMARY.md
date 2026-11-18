---
phase: 05
part: 05b
roadmap_id: V2-05 (part 05b, "Membership, invites & entitlements")
name: Database authorisation, integrity & entitlements — part 05b
status: awaiting PO gate approval (05-P6); G3 also needs V2-06
base_commit: d670b62 (05a gate tip, branch `v2/phase-05-db-authorisation-entitlements`)
head_commit: 8c1f201 (verified; later commits are docs and evidence only)
branch: v2/phase-05b-membership-entitlements (PR base = the 05a branch while open; retargets to feature/v2 after 05a merges, R-1)
---

# Phase 05, part 05b (V2-05b) — summary

05b makes the database the last line of defence for **who is still a member** and **whether the clinic may use the
product**. A removed member reads nothing with a still-valid token. Invitations are bound to one address, minted at
send time and emailed exactly once. Every clinic has a subscription row. The access level (`full`, `locked`,
`onboarding`) is enforced in RLS, storage, definer functions, token links, `/api/v1`, jobs and the dashboard pages. AI
calls have a database gate and a race-free quota. Three reviews, one re-verification and a gate-close fix (000094)
closed every High and Medium. The PO delegated decisions to the agent acting as CTO (05-P1); rulings are in
`05-PLAN.md` § Rulings and `05b-REVIEW-TRIAGE.md`. Every number below is copied from a tool output under
`evidence/05b/` or from a plan record that cites one.

## What changed, by plan
| Plan | Outcome (record) |
|---|---|
| 05-b0 contract of 05a | 000079 drops the six moved `visits` clinical columns and their CHECK (R-2), `generate_daily_queue_token` (P1-40) and the two "any membership" helpers; validates the notice `link_url` CHECK after D11n (`05-b0-CONTRACT-05A.md`). |
| 05-09a SUB-01 schema and access | 000080–000084: `billing_internal`/`private` schemas, the configurable catalogue (plans, versioned prices, entitlement keys, plan entitlements, overrides), `tenant_subscriptions` + `subscription_events` + `platform_settings`, the access and entitlement functions with caller-bound wrappers (`p_now` time travel), Standard / trial / AI-18 seeds (`05-09a-SUB01-SCHEMA-ACCESS.md`). |
| 05-09b platform RPCs | 000085: `platform_admins`, append-only `platform_audit_log`, `is_platform_admin()` (aal2), the actor rule as `private.platform_actor` (session role, R-38 erratum), five `platform.*` RPCs, SQL runbook `docs/runbooks/subscriptions-sql.md` (`05-09b-PLATFORM-RPCS.md`). |
| 05-09c seeds, v1 drop | Every test, e2e and demo clinic gets a `trialing` or comped row before enforcement; 000086 drops v1 `subscriptions`/`payment_records`; flip dry run (`05-09c-SEEDS-V1-DROP.md`). |
| 05-05 membership status | 000087: `memberships.status` (`active`/`suspended`/`removed`); the `authz` helpers read only active memberships (acceptance 4); `remove_member` revokes API keys, pending invitations and Auth sessions in-RPC (fail-soft, R-43), audited with counts; `session_is_live()` (`05-05-MEMBERSHIP-STATUS.md`). |
| 05-07a invitations v2 (DB) | 000088: one pending invitation per clinic and address, token minted at send (R-30), `invite_staff`/`resend`/`revoke`, service-role `invitation_issue_token`/`consume_invitation_for` (R-38 session-role rule), anon `peek_invitation`, reactivation of a removed member (R-32) (`05-07a-INVITATIONS-V2-DB.md`). |
| 05-07b invite app + delivery | 000089; `email.invite` handler, resend/revoke actions, `/join`, public token-gated acceptance with server-side Turnstile (R-46) and the ADR-0005 A4 importer (R-44); exactly one email under retry (acceptance 10, Mailpit) (`05-07b-INVITE-APP-DELIVERY.md`). |
| 05-10a SUB-02 enforcement | 000090: RLS and storage on the access level, definer RPCs refuse a locked clinic, token links answer `clinic_unavailable` (SUB-D6), TTL caps, `assertTenantAccess`/`requireEntitlement`, `/api/v1` 402, jobs of a non-full clinic cancelled at claim (`05-10a-ACCESS-ENFORCEMENT.md`). |
| 05-10b locked pages | Layout redirects; `/billing/locked`, `/billing/locked/staff`, `/onboarding/billing` (`05-10b-LOCKED-PAGES.md`). |
| 05-10c AI gating | 000091: `tenant_ai_settings` (owner opt-in), patient objection flag, `ai_usage_monthly`/`ai_quota_reservations`, `ai_preflight`/`ai_reserve`/`ai_commit`/`ai_release` (AI-06 L2 codes), kill switch (`05-10c-AI-GATING.md`). |
| 05-12 review fixes | 000092–000093: H-AITZ, M-AIEXP, M-CANCEL, M-REINVITE and 12 cheap Lows (`05-12-REVIEW-FIXES.md`). |
| 05b gate close | 000094: re-verification N-1 and N-2 and the objection-clear ruling, each with a test that fails without it; report gates (47 pgTAP files, floor 7892; 173 Vitest specs, floor 4826); rulings applied to the ADR and SUB (this document). |

## Migrations (000079–000094, sixteen files, immutability-gated)
| # | File | Plan |
|---|---|---|
| 000079 | `contract_05a` | 05-b0 (contract; stops on D11n > 0 at the VALIDATE) |
| 000080 | `billing_schemas` | 05-09a |
| 000081 | `subscription_catalogue` | 05-09a |
| 000082 | `tenant_subscriptions` | 05-09a (backfills existing clinics `incomplete`) |
| 000083 | `billing_access_functions` | 05-09a |
| 000084 | `subscription_seeds` | 05-09a |
| 000085 | `platform_admin_rpcs` | 05-09b |
| 000086 | `drop_v1_subscription_tables` | 05-09c |
| 000087 | `membership_status` | 05-05 |
| 000088 | `invitations_v2` | 05-07a |
| 000089 | `invitation_accept_context` | 05-07b |
| 000090 | `access_enforcement` | 05-10a (enforcement switches on here) |
| 000091 | `ai_gating` | 05-10c |
| 000092 | `review_fixes_05b` | 05-12 (expand + migrate; closes D12c rows) |
| 000093 | `contract_timezone` | 05-12 (contract; stops on D12z > 0) |
| 000094 | `gate_close_05b` | 05b gate close (function bodies only) |

Every migration commit carried the `EXPECTED_MIGRATION` bump, the schema snapshot and `db:types` (V2-04 R-45).

## Deploy notes for the staging migrate (05-P3, 05-P10)
- **Merge order (R-37).** 05b merges only after 05a has merged and its staging migrate (05-P2) is verified, or while
  staging is not live. 000079 drops columns and a function the pre-05a app reads; the first staging bring-up applies
  every migration before the app deploys.
- **Diagnostics before the migrate (counts only; 05-P8, 05-P10).** The 05a set still applies to a database migrating
  from before 05a (`05a-SUMMARY.md` § Deploy notes: D1/D1x/D5x, D6/D6d, D9t, D5s, D7i, report-only D1p/D11r/D1f).
  05b adds: **D11n** (notices with a non-relative `link_url`: 000079's VALIDATE stops on any), **D12z** (clinics whose
  `timezone` is not an IANA zone name: **000093 stops on any**; the clinic's real zone is confirmed and the row
  corrected, never guessed) and **D12c** (delivery rows left open by a cancelled job: 000092's migrate step closes them;
  0 after it). Run D12z and D12c **before 000092/000093** on any shared database. Locally all are 0
  (`evidence/05b/diagnostics/05b-close.json`).
- **Un-comped clinics lock when 000090 applies.** 000082 backfills every existing clinic `incomplete`; from 000090 such
  a clinic is `onboarding` (staff see `/onboarding/billing`). Seed or comp first: on staging (synthetic clinics) run the
  idempotent seed right after the migrate run (05-P3: `access summary: … locked=0 onboarding=0`); on any database with
  real clinics split the run before 000090 and comp each clinic through `platform.set_comp` (runbook
  `docs/runbooks/subscriptions-sql.md`) before applying 000090. New clinics stay `incomplete` until V2-13b (IND I-1).
- **Turnstile secret on staging (05-P7, R-46).** `TURNSTILE_SECRET_KEY` (the 03-E7 widget's secret) on Vercel staging,
  Production scope. Without it every invite acceptance by password is refused there (fail closed).
- **Hosted Auth "Confirm email" stays ON** (05-P9). Invitation redemption binds to the caller's confirmed email.
- **Session delete on hosted Supabase (05-P4).** `remove_member` deletes `auth.sessions` in-RPC; if the hosted
  re-check shows the delete denied, the fallback is the 900 s token lifetime (data access stops at once through RLS).
- No new dependency in 05b.

## Deviations (detail in each record's "Decisions and deviations")
- **Branch and PR shape (R-1):** `v2/phase-05b-membership-entitlements` from the 05a gate tip `d670b62`; PR base the 05a
  branch until 05a merges.
- **Review reports:** the planned `v205b-review-adversarial-billing.md` and `…-auth.md` are
  `reviews/v205b-review-adversarial-ai-billing.md` and `reviews/v205b-review-adversarial-access.md`. The fix plan
  `05b-fix` is `05-12`, plus the gate-close migration 000094 (the re-verification's cheap Lows, no further review round
  under the PO delivery-speed ruling of 2026-11-14).
- **SUB §8.1 actor block:** implemented on the session role, not `current_user` (05-09b deviation 1); erratum applied
  (R-38, below).
- **AI periods are IST** (05-12 decision 1): the trial pool is anchored on the stored trial start, the month on
  Asia/Kolkata, never the clinic's editable zone.
- **Removal of staff by the owner of a locked clinic** is allowed (05-12, IND L-5): safety over the full-access rule.
- **Objection clear** extended to an owner who holds the doctor permissions (CTO ruling below).
- Per-plan deviations: see each record (05-09a two schemas; 05-09b one shared actor helper; 05-05 helper bodies only;
  05-07a token at send; 05-07b A4; 05-10a claim-side cancellation; 05-10c IST periods after 05-12).

## Review outcome (CLAUDE.md DoD 6)
Three isolated reviews of the 05b diff `d670b62...5e9d1df`, then one adversarial re-verification of 05-12 at `3b869a9`
(reports in `reviews/`). Severity counts are copied from each report:

| Review | High | Medium | Low | Info |
|---|---|---|---|---|
| Independent (`v205b-review-independent.md`) | 0 | 2 | 7 | 7 |
| Adversarial, access/membership/invitations/platform (`v205b-review-adversarial-access.md`) | 0 | 1 | 4 | 6 |
| Adversarial, AI/quota/subscriptions/billing (`v205b-review-adversarial-ai-billing.md`) | 1 | 1 | 3 | 7 |
| Re-verification of 05-12 at `3b869a9` (`v205b-review-reverify.md`) | H-AITZ CLOSED; 0 new | M-AIEXP, M-CANCEL, M-REINVITE CLOSED; 0 new | new N-1, N-2 | new N-3, N-4; A13 |

Triage (`05b-REVIEW-TRIAGE.md`):
- **High (1): H-AITZ** (AI H-1, ACC M-1) — fixed in 05-12 (000092/000093), re-verified **CLOSED**.
- **Mediums (3): M-AIEXP, M-CANCEL, M-REINVITE** — fixed in 05-12, re-verified **CLOSED**.
- **Lows fixed in 05-12:** IND L-3 + ACC L-1, ACC L-2, IND L-6, IND L-2 + I-5, AI L-3, IND L-7, IND L-4, IND L-5,
  ACC L-3, ACC L-4 + IND I-7, IND I-6, page copy.
- **Lows fixed at the gate close (000094):** N-1 (`ai_commit` takes the usage-row lock first, then decides expiry at
  `clock_timestamp()`), N-2 (every `invite_staff` answer names the stored role; the action and the staff form show it).
- **Every fix has a test that fails without it:** 05-12's in `evidence/05b/05-12/`; the gate close's in
  `evidence/05b/close/` (`pgtap-without-000093-gate_close_05b.tap`: 8 of 12 fail at 000093;
  `vitest-without-000093-db.txt`: 3 of 4 fail; `vitest-without-app-actions.txt`: the app half; 
  `vitest-mutant-ai-commit-clock-only.txt`: the clock-only variant still fails the lock-order test).

## CTO rulings made in 05b (PO may overturn at 05-P6)
| Ruling | What | Where recorded |
|---|---|---|
| R-38 (SUB part) | SUB §8.1's actor block reads the session role, not `current_user` (inside a definer function `current_user` is the owner, so the verbatim block let any JWT caller name any admin) | Erratum in `docs/v2/SUBSCRIPTIONS_AND_PLANS.md` §8.1; `docs/v2/VERIFICATION_LOG.md` |
| R-44 | ADR-0005 amendment A4: `features/auth/invite-flows.ts` may import `features/auth/system.ts` for one function, after token, Turnstile and FT-05 checks | Applied to `docs/adr/0005-confine-service-role-client.md`; VERIFICATION_LOG |
| R-46 | Invite acceptance verifies Turnstile server-side (`TURNSTILE_SECRET_KEY`, fail closed; `action` checked since 05-12) | `05-PLAN.md` § Rulings; 05-P7 |
| Objection clear (2026-11-15) | An owner who holds the doctor permissions may also clear a patient's AI objection, audited; admins and nurses may not | `05b-REVIEW-TRIAGE.md`; 000094; VERIFICATION_LOG |
| Owner of a locked clinic (05-12) | May still remove staff, same rules and audit (IND L-5) | `05-12-REVIEW-FIXES.md` decision 8 |
| Copy (2026-11-15) | Locked/onboarding pages name no internal phase ids | `05b-REVIEW-TRIAGE.md`; 05-12 |
| `/gsd-secure-phase` (2026-11-15) | Not run for 05b; the review set (independent + two adversarial reviews + re-verification over the 05b threat rows T-05-24…T-05-38, T-05-42, T-05-43) stands in its place under the PO speed ruling, as for 05a | `05b-VERIFICATION.md` |

## Accepted or assigned, with owner
| Item | Reason | Owner |
|---|---|---|
| IND L-1 invite throttles | Needs the shared rate limiter | V2-12 |
| AI L-2 purchasable without a provider plan id | Enforcing it now blocks `start_trial` until the Razorpay plan id exists | V2-13b |
| AI I-2 reservation not tied to visit/patient | Gateway work | V2-12 |
| AI I-3 comp on a still-trialing clinic keeps trial AI | Lifecycle jobs set status at trial end | V2-13b |
| AI I-5 `tax_rate_bp` not pinned | GST may change by law; platform RPC only, audited | accepted |
| AI I-1, I-6, I-7; ACC Info; IND I-3, I-4 | No PHI or cross-tenant exposure | V2-13c / V2-14 |
| IND I-1 new clinics `incomplete` until V2-13b | Planned (R-24/R-25); deploy notes above | runbook / V2-13b |
| IND I-2 000079 drops without an emptiness assert | Applied migration; safe by construction | accepted |
| **N-3 (Info)** stale pending invitation after an accept-during-replace race | Owner-made, visible in the list; acceptable only if the member is removed within 72 h, and then re-joins with the invited role (R-32) | accepted; V2-11 (staff UI may re-check membership after the lock) |
| **N-4 (Info)** cancelled delivery rows keep `patient_name`/`recipient_phone` (only links/tokens redacted, as on `sent`/`dead_letter`) | Same as the dead path; retention governs PHI on communication rows | **V2-13 retention/purge** |
| **A13 (Info)** `ai_period` falls back to the IST month for `trialing` with a NULL `trial_start` | Only `postgres`/platform code could produce that state; `start_trial` always sets it | accepted; V2-13b (optional CHECK when lifecycle jobs land) |
| V2-12 gateway contract | Abort at the reserved timeout, commit within the 30 s grace, discard on `AI_RESERVATION_EXPIRED`; reservation cleanup job; quota keys for unmetered AI features | V2-12 |
| Staff-removal UI, owner-scoped staff list on the locked page | No UI caller today | V2-11 / V2-13b |

## Deferred, with owner (05-PLAN.md 05b gate step 5)
J-A6/J-A2 and a styled `/join` → V2-11; `saas_*` tables → V2-13b; reservation cleanup job → V2-12; draft/signed
predicates and immutable archives → V2-09a/V2-09c; dead `consultations` drop → V2-09b; paid-invoice protection → V2-10;
patient clinical-field read split if wanted → V2-08. V2-06 handover: PWA asset non-redirect cases for the locked pages
(05-10b) and the `/patients/new` guarded layout (05-12). The full `05-SUMMARY.md` / `05-VERIFICATION.md` (both parts)
are written when V2-05 closes as a whole.

## Numbers
- Vitest: 248 files / 4876 tests at the 05a close → **260 files / 5080 tests**, two consecutive runs at `8c1f201`, 0
  failed, 0 skipped; each teardown verified none of its run data remains (`evidence/05b/summary.json`,
  `full-run-{1,2}.json`). Report gate: floor 4826 (5080 × 0.95), 173 required spec files, PASS for both runs
  (`evidence/05b/close/vitest-report-gate.txt`).
- pgTAP: 31 files / 3343 tests at the 05a close → **47 files / 7892 tests**, both runs, 0 failed; gate floor 7892 (the
  measured total), 47 required files (every file), PASS for both runs (`pgtap-run-{1,2}.tap`,
  `close/pgtap-report-gate.txt`). The generated matrix alone is 6240 cells. Negative proofs: one required file removed
  (real lane) → `total 7880 is below the floor 7892` + `required pgTAP file missing`; one test dropped (real lane) →
  `total 7891 is below the floor 7892`; Vitest variants of the real report → required file missing, a skipped test,
  an emptied required file and a shrink below the floor all fail (`close/pgtap-gate-negative-*.txt`,
  `close/vitest-gate-negatives.txt`).
- Per-criterion counts for every 05b acceptance item in both runs: `close/acceptance-results.txt` ("every named spec
  and pgTAP file passed in every run").
- Playwright PR lane at `8c1f201` (fresh build, `--retries=0`): 262 passed (including the 8 KNOWN-BUG expected
  failures), 9 skipped by design, 0 failed, 0 flaky; desktop-chrome 153, pixel-7 85, iphone-15 16, setup 8
  (`close/e2e/playwright-summary.md`).
- Static: typecheck, `eslint . --quiet` (348 files) and inventory exit 0; boundary messages 0, `boundary_directives`
  `[]`, one service-role factory, exception register 2 entries, `cron_route_files` 0 (`static-checks.json`).
- Drift: local drift PASS (0 statements); schema snapshot PASS (2650 lines); authz generator `--check` exit 0.
  Diagnostics on the evidence stack: `blocking_nonzero` `[]`, D0 = 94, D11n/D12z/D12c 0 (`diagnostics/05b-close.json`).
  Policies: 122 in `public`/`storage`, 0 `FOR ALL` (`close/pg-policies-per-table.txt`).
- Gate-close fixes, without → with: `gate_close_05b` 8 of 12 fail at 000093 → 12/12 at 000094; Vitest 3 of 4 fail at
  000093 → 4/4; the app half and a clock-only mutant fail as described in `05b-VERIFICATION.md`.
- Gitleaks over the gate-close commits and documents: `close/gitleaks-commits.txt`.

## Pending PO (ids in `.planning/PO-ACTIONS.md` § "V2-05 Database authorisation & entitlements")
- **Before merge:** 05-P6 (approve the 05b gate; the 05a gate first). 05-P1 is delegated to the CTO.
- **After merge:** 05-P10 (diagnostics, delegated) → 05-P3 (approve the staging migrate, then the re-seed) → 05-P7
  (Turnstile secret) → 05-P5 (optional staging invite). 05-P4 confirms the hosted session delete. 05-P9 is a standing
  rule (Confirm email ON).
