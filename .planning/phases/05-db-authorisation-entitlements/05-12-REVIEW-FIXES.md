---
phase: 05
plan: 05-12
part: 05b (review fix plan)
subsystem: 05b review fixes (AI quota periods and reservations, clinic time zone, cancelled delivery jobs, re-invites, removal, referral guard, SUB-D6 verification, patient objection, API keys, inbound replies, page guard, Turnstile action, copy)
status: complete (local)
findings_fixed: [H-AITZ, M-AIEXP, M-CANCEL, M-REINVITE, IND L-3 + ACC L-1, ACC L-2, IND L-6, IND L-2 + I-5, AI L-3, IND L-7, IND L-4, IND L-5, ACC L-3, ACC L-4 + IND I-7, IND I-6, copy (CTO 2026-11-15)]
recorded_not_fixed: [IND L-1 (V2-12), AI L-2 (V2-13b), AI I-2 (V2-12), AI I-3 (V2-13b), AI I-5 (accepted), AI I-1/I-6/I-7 + ACC Info + IND I-3/I-4 (V2-13c / V2-14), IND I-1 (05b gate / runbook), IND I-2 (accepted)]
migrations: [000092_review_fixes_05b, 000093_contract_timezone]
plan_head_before: 1612ff6
commits: [01e07c4, be23a60, docs commit]
code_head_after: be23a60
---

# 05-12 record: fixes for the 05b reviews

**Outcome:** done locally. The three 05b reviews at `5e9d1df` (`reviews/v205b-review-independent.md` IND,
`reviews/v205b-review-adversarial-access.md` ACC, `reviews/v205b-review-adversarial-ai-billing.md` AI), triaged in
`05b-REVIEW-TRIAGE.md`, found 1 High and 3 Mediums for this plan plus 12 cheap Lows. All are fixed. Every High and
Medium has a test that fails without the fix: the database tests ran against the pre-fix migrations (the stack at
`000091`), the app tests against the pre-fix source files (each reverted to `1612ff6` for one run). Each reviewer
reproduction was rerun unchanged before and after. The Accepted/assigned items are recorded below as triaged, not
fixed. Two migrations: `000092_review_fixes_05b` (expand + migrate) and `000093_contract_timezone` (contract: diagnostic
D12z, then VALIDATE). Nothing hosted was contacted; no AI provider was called; every Supabase CLI call used `--local`.

## Finding → fix → test → fails without → reviewer reproduction

Test names: pgTAP `review_fixes_05b.test.sql` cases are numbered (n); Vitest/e2e specs are named. "Before/after" of a
reviewer reproduction is `evidence/05b/05-12/repro/before-000091.txt` → `after-000093.txt` (the same script,
`repro/repro-05-12.sql`, on the stack at 000091 and at 000093). App "without" = the source file reverted to `1612ff6`
for one run (`mutants/app-mutants-summary.txt`, `mutants/vitest-without-*.log`).

| Finding | Fix | Test | Fails without | Reviewer reproduction before → after |
|---|---|---|---|---|
| **H-AITZ** (High; AI H-1, ACC M-1) An owner or admin multiplies the 1,500-draft trial pool (and shifts the month) by editing `tenants.timezone` | 000092: `private.ai_period(tenant, at)` = `trial:<Asia/Kolkata date of the stored trial_start>` while trialing, else the Asia/Kolkata month; `private.ai_gate` uses it (never `tenant_local_date`). `tenants.timezone` CHECK `tenants_timezone_iana` (`private.is_iana_timezone`: a `pg_timezone_names` name, any case) added NOT VALID, validated by 000093 after diagnostic D12z (0 locally); trigger `tenants_timezone_audit` writes `clinic.timezone_changed` (from/to, actor, role) on every change. App: the settings schemas accept only zone names (`isIanaZoneName`) | pgTAP (1)-(12): owner and admin move the zone mid-trial → still `over_quota` / `AI_OVER_QUOTA`; the reservation is booked to the IST trial key; `ai_period` at a month boundary for UTC−12 and UTC+14 clinics → the IST month; an override clinic at its monthly limit stays `over_quota` after zone changes; unknown, offset, abbreviation and blank zones refused (23514); audit row; CHECK validated. `ai_quota` 7 now asserts the IST month. Vitest `ist-boundaries` (7 refused zones), `datetime.spec` (`isIanaZoneName`) | At 000091: (1)-(5), (7)-(9), (11), (12) fail; (6) and (10) pass before and after (guards). Mutant (`ai_period` on the clinic's zone, `mutants/pgtap-mutant-ai-period.tap`): (1)-(5) fail, so the month legs fail on behaviour, not only on the missing function | P1.1 owner sets `-23`: `-23` → refused (23514). P1.2 preflight: `ok` → refused / with a legal far zone `over_quota`. P1.5 admin `+00`: accepted → refused. P1.6 audit rows 0 → 1. Trial keys reachable: 3 → 1. Pools answering `ok` with 1,500 used: >0 → 0 |
| **M-AIEXP** (AI M-1) `ai_commit` accepts an expired reservation, so units exceed the limit | 000092 `ai_commit`: the reservation is read `FOR UPDATE`; `expires_at <= now()` raises P0001 `AI_RESERVATION_EXPIRED` (mapped to CONFLICT); nothing changes. Recorded V2-12 gateway contract below | (13) commit of an aged reservation; (14) the reviewer's P2: 1,499 used, r1 expires, r2 reserved and committed (1,500), r1's commit refused; (15) control: a live one commits to exactly 1,500 | (13), (14) fail at 000091 (`1501` in (14)); (15) passes before and after | P2.4 units vs limit: 1501 → `AI_RESERVATION_EXPIRED` (stays 1500) |
| **M-CANCEL** (IND M-1, AI L-1) A cancelled (`tenant_not_full`) job leaves its delivery row open and unredacted; the backfill re-sends it after renewal | 000092 trigger `jobs_delivery_cancelled` (`ops.delivery_job_cancelled`, AFTER UPDATE OF status, cancelled message.send / webhook.deliver): `communication_queue` → `cancelled` (`job_cancelled:<reason>`; the scrub trigger redacts links/tokens as on the dead path), `webhook_delivery_queue` → `failed`. The backfill reads only open rows, so it never recreates them. Migrate step closes rows already left open (D12c: 0 locally). Runbook `jobs.md` §11 updated | (23) reminder through `enqueue_message`, clinic locks, claim → job cancelled, row `cancelled`, `document_url` `[redacted]`; (24) job cleaned up, renewal, backfill → no job; (25) webhook row `failed`, not recreated; (26) cancelled `email.invite`: invitation still pending, resend after renewal makes v2. Vitest `lock-enforcement` "a reminder enqueued through enqueue_message…" (real runner pass) | (23)-(25) fail at 000091 (row `pending`, backfill recreates); (26) passes before and after (guard) | P5.1 queue row `pending` → `cancelled`, link → `[redacted]`. P5.2-5.4 claimed again after cleanup + renewal + backfill: 1 → 0 |
| **M-REINVITE** (IND M-2) Re-inviting an address with another role silently keeps the earlier role; the app reports success | 000092 `invite_staff`: a pending invitation for another role is revoked (`staff.invite_revoked` with `replaced_by_role`) and a new one created and emailed (`staff.invited` with `replaced_role`); the answer adds `replaced_role`; replacing a pending owner/admin invitation is owner-only. Same role → still `deduped`. App: `inviteStaff` returns `outcome` `sent` / `replaced` (+ `previousRole`) / `already_pending`; the staff form says which | (27) admin → receptionist: new id, admin revoked, 2 email jobs; (28) same role deduped; (29) an admin cannot replace a pending admin invitation; (30) audit. `invitations_v2` 16 now dedupes the same role. Vitest `tests/staff/reinvite-role.spec.ts` (the action's outcome; **the invitee who accepts joins as receptionist**) | (27), (29), (30) fail at 000091; (28) passes before and after. App: `staff-actions` mutant fails the reinvite spec | Second answer `{"deduped": true}`, stored role admin, 1 job → `{"deduped": false, "replaced_role": "admin"}`, receptionist, 2 jobs |
| IND L-3 + ACC L-1 A removed member's webhook subscriptions keep delivering | `remove_member` disables the member's subscriptions in the clinic and rotates their signing secrets; `webhooks_disabled` in the answer and the audit row | (31). `remove_member` 28/40/43 and Vitest `remove-member` audit keys include `webhooks_disabled` | (31) fails at 000091 | is_active true, secret unchanged → false, rotated |
| ACC L-2 API-key auth does not re-check the creator | `authenticateApiKey`: the creator must be an active owner/admin of the key's clinic, else 401 (same text as a revoked key) | Vitest `lock-enforcement` "a key whose creator was demoted from admin, or suspended…" | `api-key-creator` mutant: fails | (app; by code in the review) demoted/suspended creator's key 200 → 401 |
| IND L-6 `ai_commit` / `ai_release` not bound to the reserving user | `ai_quota_reservations.created_by` (set by `ai_reserve`); commit/release need `created_by = auth.uid()` in the active clinic, or the system path (session role service_role/postgres, R-38); EXECUTE + service_role | (16)-(19); `ai_quota` reservations carry the doctor as creator | (16)-(19) fail at 000091 | another doctor commits: ok → `AI_RESERVATION_NOT_FOUND`; releases: true → false |
| IND L-2 + I-5 Quota key derived as `<feature>.monthly_drafts`; null-limit comment | `entitlement_keys.quota_key` (ai.scribe → monthly_drafts, ai.voice_receptionist → monthly_minutes); an AI feature without one raises `AI_QUOTA_NOT_CONFIGURED`. `EntitlementValue.limit` is a number (0 = none), comment fixed | (20)-(22); Vitest "limits are numbers" | (20)-(22) fail at 000091; the Vitest leg passes with the old helper (I-5 is a type/comment contract fix) | voice receptionist with an override: `over_quota` → `ok`; `ai.scribe.voice`: `not_entitled`/`killed` → `AI_QUOTA_NOT_CONFIGURED` |
| AI L-3 Clearing the objection is unaudited and open to nurses | Trigger `patients_ai_objection_audit` (definer): `patient.ai_objection.set` / `.cleared` (actor, role, no PHI); a signed-in clear only by doctor or receptionist (42501 `AI_OBJECTION_CLEAR_FORBIDDEN`) | (39)-(42) | all fail at 000091 | nurse clears: 1 row → refused; audit rows 0 → 2 |
| IND L-7 Referral guard accepts a removed doctor | `referrals_directory_consent_guard`: target doctor must be an ACTIVE member | (34), control (35) | (34) fails at 000091 | inserted → `REFERRAL_TARGET_DOCTOR_INVALID` |
| IND L-4 SUB-D6 restricted answer carries the patient name, lacks doctor details | `resolve_share_token` builds the restricted object: `clinic.name`, `verification` {`valid`, `doctor_name`, `doctor_registration_number`, `issued_on`} only. App: `resolveShareToken` → `status: "restricted"`; `/r/[token]` shows the verification card; download routes 404 | (36)-(38); Vitest `lock-enforcement` SUB-D6 (exact shape, no patient name); e2e `share-verification.spec.ts` (signed out; axe 360/820/1280) | (36)-(38) fail at 000091; `sub-d6-app` mutant fails | keys with `patient_name`, `title`, `original_filename` → `access,clinic,resource_type,restricted,status,verification`; patient name present: true → false |
| IND L-5 A locked clinic's owner cannot remove staff | `remove_member` admits the active clinic at `locked`/`onboarding` for its active OWNER (same rules, audit). `removeStaff` falls back to billing access for an owner | (32), (33) (an admin still refused); `definer_functions` locked leg now proves the owner may; Vitest `remove-member` "removeStaff in a locked clinic" | (32) fails at 000091; `staff-actions` mutant fails the owner leg | owner removes: `MEMBER_NOT_FOUND` → removed |
| ACC L-3 WhatsApp replies change a locked clinic's visits | Inbound route: after the match, `tenant_access_for_system`; not `full` → answered like an unmatched reply, nothing changes | Vitest `msg91-webhook` "[Locked clinic] …" | `inbound-locked` mutant fails | (by code in the review) visit cancelled → stays booked, `bot_not_found` reply only |
| ACC L-4 + IND I-7 Pages render empty for a locked clinic on client navigation | `withPageAuth` checks the access level before the loader; `/patients/new` gets a guarded segment layout | Vitest `locked-redirects` now requires the redirect from every page (16 incl. `/patients/new`) | `page-precheck` mutant: all three role legs fail | (by code) `/`, `/patients`, `/visits`, … rendered empty → redirect |
| IND I-6 Turnstile `action` not verified | `verifyTurnstile({ expectedAction })` → `action_mismatch`; invite acceptance passes `invite-accept` | Vitest `turnstile-verify` (2 new legs; the fake siteverify answers `wrongaction…` with action `login`) | `turnstile-lib` and `turnstile-action` mutants fail | (by code) another widget's token accepted → refused |
| Copy (CTO 2026-11-15) | Locked/onboarding texts without phase ids | Vitest `locked-redirects` "no text … names an internal id"; e2e `locked.spec.ts` text | `copy-ids` mutant fails | `(V2-13b/V2-13c)`, `AUTH-07/SUB-03 in V2-13b` → gone |


## Accepted / assigned (recorded, not fixed; triage table)

| Item | Reason | Owner |
|---|---|---|
| IND L-1: invite throttles (20 sends/h per clinic, 3 resends, 10 accepts/h per token) | Needs the shared rate limiter scheduled for V2-12; deferral now recorded | V2-12 |
| AI L-2: a plan purchasable without a provider plan id; Standard seeded so | Enforcing it now blocks `start_trial` until the Razorpay plan id exists | V2-13b |
| AI I-2: reservation not tied to visit/patient (objection during the window) | Gateway work | V2-12 |
| AI I-3: comp on a still-`trialing` clinic keeps trial AI entitlement | Lifecycle jobs set status at trial end | V2-13b |
| AI I-5: `tax_rate_bp` not pinned to 1800 | GST rate can change by law; platform-admin RPC only, audited | — (accepted) |
| AI I-1, I-6, I-7; ACC Info items; IND I-3 (suspended unused), I-4 (platform actor ids visible to owners) | Recorded; no current exposure of PHI or cross-tenant data. (AI I-1 is narrowed by 05-12: the gateway can now commit on the system path) | V2-13c / V2-14 |
| IND I-1: new clinics land on `/onboarding/billing` until V2-13b; un-comped clinics lock when 000090 applies | Planned (R-24/R-25); stays in the deploy runbook | 05b gate / runbook |
| IND I-2: 000079 drops columns without an explicit emptiness assert | Applied migration; safe by construction (000053 moved content, checked) | — (accepted) |


## Decisions and deviations

1. **AI periods are anchored to IST, not to the clinic's zone** (H-AITZ). The trial key is the Asia/Kolkata date of the
   stored `tenant_subscriptions.trial_start` (no API role can write it), the month the Asia/Kolkata month (AI §4.6 "IST
   calendar month", SUB §4's billing anchor). For a clinic in Asia/Kolkata (every clinic today, and the default) the
   keys are unchanged, so no usage row moves; a clinic in another zone would book from its IST key on.
2. **`tenants.timezone` must be an IANA zone name** (case-insensitive, `pg_timezone_names`; offsets, `IST`, blanks and
   unknown names are refused). The CHECK is evaluated with the writer's privileges, so `private.is_iana_timezone` (a
   pure catalogue lookup, `search_path = ''`) is executable by `authenticated` and `service_role`, not `anon`.
   `tenant_local_date` still tolerates legacy values; `tenant_local_dates.test.sql` drops the CHECK inside its own
   (rolled-back) transaction to keep proving that. Changing the zone stays an owner/admin setting (`clinic:manage`,
   as today), now audited; the AI quota no longer depends on it.
3. **M-AIEXP: refuse, not count.** `ai_commit` of an expired reservation raises `AI_RESERVATION_EXPIRED` and changes
   nothing (the expired row stops counting at `expires_at` and is left for V2-12's cleanup job). **V2-12 gateway
   contract (recorded):** the gateway aborts the provider call at the timeout it reserved (`p_timeout_s`, clamped
   10…300 s; the reservation lives timeout + 30 s), commits within the 30 s grace, and on `AI_RESERVATION_EXPIRED`
   discards the draft ("could not draft"), never retries the commit and never shows a late draft.
4. **IND L-6 system path.** `ai_commit` / `ai_release` gain a system path (session role `service_role`/`postgres`,
   R-38: the session role, never `current_user` inside SECURITY DEFINER) and EXECUTE for `service_role`; it acts on
   any reservation by id. This also narrows AI I-1 (a gateway can meter a call whose user lost the role meanwhile).
5. **IND L-2: an unmetered AI feature is a configuration error** (`AI_QUOTA_NOT_CONFIGURED`, raised before any
   per-clinic check, like `AI_FEATURE_UNKNOWN`), not a code of the L2 contract. `ai.scribe.voice`,
   `ai.operations_copilot`, `ai.patient_advice` and `ai.clinical_copilot` have no quota key: V2-12 sets one (or meters
   them under an existing key) before gating them.
6. **M-CANCEL as a trigger** (`jobs_delivery_cancelled`), mirroring the dead-path triggers, so any cancellation closes
   the row (only `claim_jobs` cancels today). A webhook row becomes `failed` (its status set has no `cancelled`), as on
   the dead path. No in-app "delivery failed" note is written for a cancellation: the clinic is locked and cannot read
   it. A cancelled `email.invite` needs no change: the invitation stays pending and `resend_invitation` works after
   renewal (pgTAP (26)).
7. **M-REINVITE replaces rather than refuses** (the triage's choice). The concurrent-insert branch (two simultaneous
   invites to one address) still returns the winner as `deduped`; the app then says an invitation is already pending.
8. **IND L-5 without new UI.** No removal UI exists yet anywhere (`removeStaff` has no UI caller, full clinic
   included), so the fix is the database rule and the action. A draft `locked_clinic_staff()` list RPC for the locked
   page was dropped before commit to avoid unused definer surface; the staff UI is V2-11's (R-31, the action's own
   comment) and the locked owner page's is V2-13b's (open item).
9. **AI L-3: clearing is doctor or receptionist only** (AI §4.6 read literally): the owner, admin and nurse are
   refused; setting the flag still follows `patients:edit`. Whether a practising owner may clear it is a PO question
   (open item).
10. **IND L-4:** `valid` is the prescription's status `active` (an amended or cancelled one reads "no longer valid");
    the issue date is the clinic date of `signed_at` (else `created_at`); the clinic phone is no longer in the
    restricted answer (not in SUB §7.2's set). The page shows a dedicated verification card.
11. **ACC L-3:** the locked clinic's reply is answered like an unmatched one (the tenant-less `bot_not_found`), so no
    new template was needed and nothing about the clinic is revealed.
12. **ACC L-4:** `withPageAuth` now resolves the membership and the access level before every wrapped page's loader
    (one `getUser`, one membership read and one `my_tenant_access` call more per dashboard page load).
13. **Existing tests changed because the contract changed** (each named in the table): `ai_quota` (IST month,
    reservations carry their creator), `definer_functions` (2 new internal triggers, `service_role` on commit/release,
    `remove_member` access handling `owner_only` and its locked leg), `invitations_v2` 16 (same-role dedupe),
    `remove_member` 28/40/43 (`webhooks_disabled`), `tenant_local_dates` (drops the CHECK in-transaction),
    `ist-boundaries` (refused zones), `invite-token-lockout` (`outcome`), `locked-redirects` (redirect required from
    every page; copy), `lock-enforcement` (SUB-D6 shape).
14. **Shared stack:** the reproduction script ran once on the fixed stack (between the 01:52Z reset and the final
    lanes) without the test-run lock; it is one
    rolled-back transaction on synthetic `d512…` rows. Every other run took the lock.


## Local evidence (tool output, `evidence/05b/05-12/`)

Lanes ran on `268a1a9`, whose tree is identical to `be23a60` (the app commit was re-made without an intermediate
commit that carried a literal test password; `git diff 268a1a9 be23a60` is empty; `lanes-sha.txt`).

| Check | Result | File |
|---|---|---|
| pgTAP lane + gate (stack at 000093) | **46 files, 7880/7880**; gate PASS (floor 7880, 46 required) | `pgtap-lane.tap`, `pgtap-report-gate.txt` |
| Full Vitest + gate | **258 files, 5076/5076**, 0 failed, 0 skipped; gate PASS (floor 4823, 164 required). The first full run (before the commit) had 4 failures, all in `invite-token-lockout.spec.ts` comparing the whole `inviteStaff` result (it now has `outcome`); fixed in the app commit | `vitest-summary.json`, `vitest-report-gate.txt` |
| e2e PR lane, fresh `e2e:build` (on `be23a60`, `--retries=0`) | **262 passed** (incl. the 8 annotated known-bug failures), 9 skipped, **0 unexpected, 0 flaky, 0 retried**; the new `share-verification.spec.ts` passed on desktop-chrome and pixel-7 (axe 0 serious/critical at 360/820/1280, no horizontal scroll at 360). A first attempt never started: another worktree's run took the test-run lock between my wait and Playwright's start (`Another test run … is using the local stack`); the rerun held the lock for the whole lane (nested lock dir) | `e2e/playwright-summary.md`, `e2e/playwright-stats.json`, `e2e/e2e-pr-tail.txt`, `e2e/e2e-05-12-specs.txt` |
| `review_fixes_05b` at 000091 (pre-fix) | **35 of 42 fail**; the 7 that pass are guards that hold before and after: (6), (10), (15), (26), (28), (33), (35) | `pgtap-without-000091-review_fixes_05b.tap` |
| Changed files at 000091 | `ai_quota` 12/41 fail (its fixtures now set `created_by`, which 000091 lacks), `definer_functions` 3/71, `remove_member` 3/81, `tenant_local_dates` aborts (no CHECK to drop), `invitations_v2` passes (same-role dedupe is unchanged behaviour) | `pgtap-without-000091-*.tap` |
| `review_fixes_05b` at 000093 | 42/42 | `pgtap-with-000093-review_fixes_05b.tap` |
| Mutants | DB: `ai_period` on the clinic's zone → (1)-(5) fail; restored, `schema-snapshot --check` PASS. App: 9 source files reverted to `1612ff6` one at a time; 8 fail their specs, `require-entitlement.ts` passes (I-5 is a contract/comment fix) | `mutants/` |
| Reviewer reproductions, before (000091) and after (000093) | every listed reproduction changes as in the table above | `repro/repro-05-12.sql`, `repro/before-000091.txt`, `repro/after-000093.txt` |
| Diagnostics after 000093 | D12z 0, D12c 0/0 | `diagnostics/05-12-after-000093.json` |
| typecheck, `eslint --quiet`, inventory (0 flagged), ai-l1, `env-example --check`, `schema-snapshot --check`, `db:drift:local`, `authz:gen --check`, migration immutability (base `1612ff6`: 91 unchanged, 2 new), no-doc-grep | all PASS | `static-checks.txt` (HEAD `be23a60`; `development/static-checks-precommit.txt` before the commit) |
| gitleaks 8.30.1 (repo config) | `1612ff6..be23a60` (2 commits): **no leaks found**; the docs commit's files (record, wave notes, evidence) scanned before committing: no leaks found. An earlier local commit with a literal synthetic test password was flagged and re-made before anything left the machine (the password is now built at run time) | `gitleaks.txt` |

`ui-policy` is not a script on this branch (V2-06 adds it); nothing to run here.


## Threats

- **T-05-37 (AI quota abuse):** the zone lever (H-AITZ) and the expired-commit overshoot (M-AIEXP) are closed and
  proven; reservations are bound to their user.
- **T-05-38 (AI for an objecting patient):** clearing the objection is now restricted and audited.
- **T-05-31..34 (access stop):** delivery rows of locked clinics are closed and scrubbed; inbound replies of a locked
  clinic change nothing; pages redirect before their loader; the restricted share answer carries no patient name.
- **T-05-24..26 (removal):** a removed member's webhooks stop and their secrets rotate; an API key needs an active
  owner/admin creator; a locked clinic's owner can still remove a dismissed member.
- New surface: `private.is_iana_timezone` (EXECUTE `authenticated`, `service_role`; a catalogue lookup, no tenant
  data); `service_role` EXECUTE on `ai_commit`/`ai_release` (system path, session-role checked); three definer
  triggers (`tenants_timezone_audit`, `patients_ai_objection_audit`, `ops.delivery_job_cancelled`) with no API grant.
  No new table, policy or route.


## Open items

- **V2-12:** gateway contract of decision 3 (abort at the reserved timeout, discard on `AI_RESERVATION_EXPIRED`) and the
  expired-reservation cleanup job; quota keys for the AI features that have none (decision 5); commit through the
  system path where the caller may have lost the role (AI I-1); the opt-in/objection UI (who may clear, item below).
- **PO:** may a practising owner clear a patient's AI objection (decision 9)? Today only doctor or receptionist can.
- **V2-11 (R-31) / V2-13b:** staff-removal UI (the staff page, and the locked owner page, decision 8); the locked owner
  page then needs an owner-scoped staff list (the memberships policy hides other members from a locked clinic).
- **05b gate / deploy runbook:** run diagnostics D12z (clinics with a non-IANA zone: 000093 stops on any) and D12c
  (delivery rows left open by cancelled jobs) before 000092/000093 on any shared database. Locally both are 0.
- **Settings billing copy:** "Plan management arrives with billing (V2-13b)." on `/settings/billing` still names a phase
  id; it is not a locked/onboarding page (outside this triage item) and V2-06 owns that page's redesign.

