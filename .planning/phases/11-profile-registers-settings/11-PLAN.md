---
phase: "11"
roadmap_id: V2-11
name: Profile, registers, staff and settings, public pages
revision: "2026-11-28, first (CTO authority delegated by the PO; deadline: all phases except go-live done by 6 Dec 2026)"
gate: "G4 (light, per PR): one isolated reviewer (Sonnet) over the registers and their pagination, the patient profile sub-routes, staff lifecycle and invites UI, the settings regroup, public token pages at 320 px, PWA entries, the M5 deletion diff and the guards at error, the lane rows; one adversarial security reviewer (Opus) over migrations 000150 to 000155, the access-token hook change (time-box and inactivity), requireRecentAuth and aal2, owner TOTP, owner transfer, owner email change, suspend/remove (sessions, keys), auth events and their retention, the register reads (another clinic, roles, search abuse), document void and share-token revocation, public token pages (no PHI beyond today's), idle sign-out; one fix round (11-07). Approval: the PO, or Claude under the delegated CTO authority (VERIFICATION_LOG :924 covers V2-07 to V2-11 merges into feature/v2) with the CI run recorded."
requirements: ["P2-05 (patient profile and history; paginated registers with URL filters; settings regroup)", "AUTH-05 UI (suspend, reactivate, remove)", "AUTH-06 UI (invite, resend, revoke, styled /join)", "AUTH-08 clinic side (owner TOTP, requireRecentAuth, owner email change, owner transfer)", "AUTH-09 (session policy 14-day time-box and 7-day inactivity, sign out everywhere with last sign-in, idle local sign-out)", "FT-06 (app-side session policy on Supabase Free, timestamps through a SECURITY DEFINER function)", "FT-07 (auth events kept >= 180 days in India within a size budget)", "P1-24 (labs relabelled as documents, PO-5)", "P1-42 journeys 2 and 10", "PWA 'Install app' and 'Check for updates' in Profile (PWA_STRATEGY.md:473)", "M5 cleanup and enforcement (delete v1 components, palette reset, ui-policy guards at error, template removed)", "Hand-offs: 05 R-31 (J-A2, J-A6, styled /join), 05 R-35 (referral directory toggle), 08 (profile/history, AI-objection editing, directory pagination, schedule blocks page), 09A (lab document void), 09B (macros settings page), 09C (allergy editor in the profile, hide Rx for roles without prescriptions:edit), 06 (Profile install entries, idle leg), 03 (MFA factor notification emails)"]
plans: ["11-01", "11-02", "11-03", "11-04", "11-05", "11-06", "11-07", "close"]
order: "11-01 -> 11-02 -> 11-03 -> 11-04 -> 11-05 -> 11-06 -> reviews -> 11-07 -> close (sequential; one local stack; one executor). 11-06 (M5) last because every earlier plan rebuilds the heaviest v1 files."
migrations: {"11-01": "000150_registers", "11-02": "000151_patient_profile", "11-03": "000152_staff_lifecycle", "11-04": "000153_session_policy_auth_events", "11-05": "none", "11-06": "none", "11-07": "000154_review_fixes_11 (only if a fix needs SQL)"}
migrations_note: "Reserved range 000150-000159; V2-10 uses 000140-000149. Every migration commit bumps expected-migration.ts, the schema snapshot, types/database.ts and assert-pgtap-report.mjs (REQUIRED_FILES, FLOOR with arithmetic)."
new_dependencies: {}
base_commit: "the V2-10 merge on feature/v2 (11 reuses lib/pagination, lib/money and the invoice sheet)"
branch: "v2/phase-11-profile-registers-settings -> one PR into feature/v2"
---

# V2-11 Profile, registers, staff and settings, public pages: plan

## Goal

Finish every remaining screen on the v2 system and delete v1. Registers page in SQL with their filters in the URL; a patient's
profile opens in one round trip with deep-linkable tabs; an owner runs the whole staff lifecycle (invite, resend, revoke, suspend,
reactivate, remove, transfer ownership) without help; owners can protect the clinic with TOTP, sensitive actions ask for recent
authentication, and sessions end at 14 days or after 7 idle days even on Supabase Free. Public pages work at 320 px. At the end the
palette reset is on, every ui-policy guard blocks, and no v1 component is left (PO-15: no soak).

Tracer: 11-01 pages the Patients register (50 rows, `?q=` search, next page) from one SQL read through the shared keyset helper built
in V2-10 (10-05), before any other change.

## Current state (inventory at c609907a; file:line in 11-RESEARCH-NOTES.md)

| Area | Today | Gap | Plan |
|---|---|---|---|
| Patients list | whole `patients` table read, client filter (`patients/(list)/page.tsx:13-36`) | server keyset + search | 11-01 |
| Visits register | URL params exist; `features/visits/service.ts:261` fetches all then slices | server pagination | 11-01 |
| Referrals register | all inbound/outbound, no params | paginated, URL filters | 11-01 |
| Patient profile | v1 tab bar in one 658-line view; history streamed unpaginated; documents fetched on mount; 4 awaited reads before paint | sub-routes, one read, paginated history | 11-02 |
| Labs naming | "Lab Reports & Records" in 4 files; no document void (09A) | "Documents"; void with reason | 11-02 |
| Staff | invite form, list, edit modal; no suspend/reactivate/resend/revoke/remove UI; `memberships.status = 'suspended'` reserved, no command | full lifecycle | 11-03 |
| Owner transfer | only `change_member_role` | transfer command + re-auth + audit | 11-03 |
| Settings | `settings/{clinic,billing,developer}`, `/profile`, `/staff`; IA target `/settings/{clinic,team,schedules,plan,integrations}` | regroup | 11-03 |
| MFA, re-auth | config only; no `auth.mfa`, no aal2, no `requireRecentAuth`; `lib/auth/sensitive-actions.ts` closed list is the hook | owner TOTP, recent-auth gate | 11-04 |
| Session policy | JWT 900 s; `session_age_token_hook` (000030); no 14/7-day rule; `hardSignOut('idle')` exists without a timer; "Sign out of all devices" exists | time-box, inactivity, idle timer, last sign-in | 11-04 |
| Auth events | log lines only; `audit_logs.tenant_id NOT NULL` | `ops.auth_events`, 180 days | 11-04 |
| Public pages | `/r/[token]`, `/reschedule/[token]`, `/reports/view`, `/join` with raw-palette classes | V2-06 parts, axe at 320 | 11-05 |
| PWA entries | Install / Check for updates in the More sheet and user menu | Profile entries, desktop check | 11-05 |
| Journeys | 01, 03-06, 08, 09 (07 from V2-10) | 2, 10; J-A2, J-A6, J-A7 | 11-03 to 11-05 |
| M5 | ui-policy report-only: raw-palette 3,334, px-font 266, link-wraps-button 30, window-dialog 27, arbitrary-color 2; jsx-a11y at warn; no palette reset; `docs/temp/free-nextjs-admin-dashboard-main` present | 0 everywhere, reset on, blocking | 11-06 |

## DECISIONS (CTO, delegated; one line each; the PO may overturn at the gate)

| # | Decision | Rationale |
|---|---|---|
| D-1 | Every register uses `lib/pagination/keyset.ts` (V2-10): 50 rows, cursor in the URL with the filters, one INVOKER SQL read per page returning rows + `next_cursor` + a capped count (`count ≤ 1,000`, shown "1,000+"). | One pattern; exact counts on large tables cost a scan. |
| D-2 | Patient search on the register is server-side (prefix on name, digits on mobile, existing `search_patients` rules), 200 ms debounce; PHI never cached on the device (09E R-9). | Same rule as the Today picker. |
| D-3 | Profile tabs are sub-routes `/patients/[id]/{overview,visits,documents,billing,consent}`; `overview` is the default; `patient.view` is written once per opening of the profile (the layout), not per tab. | Deep links (M4.6) without multiplying the audit row. |
| D-4 | Visit history inside the profile: 20 per page, filters `type`, `doctor`, `from`, `to` in the URL, through the same keyset helper. | M4.6 "timeline filters in the URL". |
| D-5 | "Labs" becomes "Documents" everywhere in the UI and nav; table and route names unchanged (`lab_documents`). Document void = `void_patient_document(reason)` (append-only kept, 000110): sets `voided_at/by/reason`, revokes its share tokens, keeps the file. | PO-5; no rename migration; 09A hand-off. |
| D-6 | Suspend = membership `suspended`: sessions for that clinic membership ended (`auth.sessions` of the user deleted when it is their only active membership, else the clinic access refused by `status = 'active'` gates), API keys and pending invites they created untouched. Reactivate = back to `active`. Remove = existing `remove_member`. | `authz.*` already reads only active memberships; suspend must be reversible. |
| D-7 | Owner transfer = `transfer_ownership(p_new_owner_id, p_step_down boolean)`: target must be an active admin; most-sensitive re-auth; audit `staff.owner_transferred`; the last-owner guard stays. | AUTH §3.7. |
| D-8 | Session policy without Pro: the existing access-token hook (`private.session_age_token_hook`, SECURITY DEFINER) reads `auth.sessions.created_at` / `refreshed_at` for the session being refreshed and **refuses to issue** a token when created > 14 days ago or the previous refresh is > 7 days old; it also adds `sess_iat` (session created) to the claims so `proxy.ts` ends a 14-day session between refreshes with no database call. | FT-06 with zero added calls per request (09E budgets); the refusal cannot be bypassed by the client. |
| D-9 | Idle local sign-out: 10 minutes without input on consult, patient profile and Rx screens (Today exempt), `hardSignOut('idle')`, PHI covered on `visibilitychange`, `/login?email=` prefilled. | AUTH §3.6. |
| D-10 | Auth events in `ops.auth_events(id, at, user_id, tenant_id NULL, event, method, aal, ua_class)` written only by `public.log_auth_event` (DEFINER, closed event list, actor = `auth.uid()`; pre-auth events by the server's system path through the auth routes); 180-day retention in `ops.cleanup()`; size budget 200,000 rows with an overflow counter (as `ops.rum_overflow`). | `audit_logs` needs a tenant; FT-07 within the Free 500 MB. |
| D-11 | aal2 (when the owner has a verified TOTP factor) or a password within 10 minutes is required for: subscription/mandate pages, role grants, owner transfer, owner email change, API keys and webhooks, data export, clinic deletion, MFA unenrol. Refund/void (V2-10) is not in the list. | AUTH §3.5/§4.6 list as written; refunds stay desk-speed and are capped by permission. |
| D-12 | TOTP in tests uses a 30-line RFC 6238 helper on `node:crypto` (`tests/helpers/totp.ts`), not `otplib`. | No new dependency (CLAUDE.md). |
| D-13 | Test IDs follow AUTH_REDESIGN: J-A7 = idle sign-out; the owner TOTP journey is new **J-A11** (J-A8 stays the platform-admin one, V2-13c). | The roadmap's "MFA (J-A7)" is a naming slip; both are built. |
| D-14 | Journey 10 runs on the existing pieces: booking → `appointment_booked` outbox row → the jobs runner invoked locally → messaging provider `fake` (no network) → a signed DLR POST to `/api/webhooks/messaging/[provider]` → delivery status `delivered` shown. | TEST_STRATEGY §7 journey 10 without V2-12's governance work. |
| D-15 | Settings regroup to the IA: `/settings/{clinic,team,schedules,plan,integrations}` plus `/profile` (personal, security, install); old URLs redirect (308) until the close, then the redirects stay (cheap). `/staff` → `/settings/team`, `/settings/developer` → `/settings/integrations`, `/settings/billing` → `/settings/plan`. | IA doc as approved. |
| D-16 | Notification emails "a sign-in factor was added/removed" and "your email was changed" go through the existing send-email path (03 hand-off). | Cheap, closes a known gap. |
| D-17 | M5 raw-palette sweep by a reviewed codemod (`scripts/ui/palette-codemod.mjs`, mapping table raw class → token class from DESIGN_SYSTEM, unmapped hits fail the script) after 11-01..05 have rebuilt the heaviest files; screenshots of the g3 screen list at 360/820/1280 before and after are attached to the notes. | 3,334 hits cannot be hand-edited in the time; a table is reviewable. |

## CTO decisions needed (true conflicts with approved docs; recommendation applies unless overturned)

| # | Conflict | Approved doc | Recommendation |
|---|---|---|---|
| X-1 | The IA moves `/visits` and `/referrals` to `/records/*` and the consult to `/visits/[id]/consult` (09B hand-off); doing it touches every e2e and lane row in the last week | INFORMATION_ARCHITECTURE.md :23, :28 | **Defer the `/records/*` and consult URL moves to v2.1** (labels and nav groups follow the IA now; URLs stay). Settings regroup (D-15) is done. Amend the IA with "URL moves deferred". |
| X-2 | M5 acceptance "0 sub-12 px text … axe 0 across all routes" plus "Bundle budgets blocking" (FRONTEND_MIGRATION_PLAN M5) vs PWA_STRATEGY :455 (bundle budgets blocking at V2-15) | FRONTEND_MIGRATION_PLAN §M5; PWA_STRATEGY | Follow PWA_STRATEGY: bundle budgets stay report-only until V2-15; every other M5 guard blocks at the end of 11-06. |
| X-3 | Roadmap V2-11 tests name "MFA (J-A7)"; AUTH_REDESIGN defines J-A7 as idle sign-out | V2_MASTER_ROADMAP §12 V2-11; AUTH_REDESIGN :483 | D-13 (both journeys; MFA = J-A11); fix the roadmap line at the close. |
| X-4 | jsx-a11y recommended rules are at `warn` in ESLint; M5 says "CI guards switch to blocking" without naming ESLint | FRONTEND_MIGRATION_PLAN §M5 | Switch jsx-a11y to `error` in 11-06 with the violations fixed; `no-explicit-any` stays `warn` (not a UI guard; V2-14 sweep). |

## Shared rules for every plan (09E conventions)

- **Reads** INVOKER, STABLE, `search_path = ''`, tenant from the session checked with `has_permission` (forged tenant → nothing), narrowest
  output (no field the screen does not show), versions from the same statement where the screen shows a changed-elsewhere notice; pgTAP
  file each (grants, another clinic, every role, shape allow-list) and a `command-latency.ts` entry.
- **Commands** follow V2-07 (guard block, `command_claim` replay before any compare, row lock, `ROW_CHANGED` on `p_expected_version` when the
  row has a version, machine reasons in `lib/db/errors.ts`, audit in the transaction, `command_complete`, EXECUTE `authenticated` only);
  every write moves the right domain version (`settings` for staff and settings, `queue` untouched); catalog entry per command.
- **Routes and actions**: session, permission, tenant from the session, fixed error bodies, `private, no-store` for tenant data; every new or
  removed action/route in `tests/security/guard-manifest.ts` and `npm run inventory`; sensitive ones added to `lib/auth/sensitive-actions.ts`
  (D-11) with a guard-manifest marker that the engine checks.
- **Screens** without a live domain show "Changed on another device · Refresh" on a newer version (09E R-9) and never re-render themselves;
  `/patients/[id]` is never prefetched (it writes `patient.view`); PHI stays `no-store` and never in device storage.
- **Saves** through `useConfirmedCommand` (confirm class: staff lifecycle, settings, document void, allergies) or `useReversibleCommand` where
  09E-08 lists the action; one call; result applied with `setQueryData`; no `revalidatePath` on a hot path.
- **Lane rows** (`tests/e2e/perf/latency-budgets.ts`): each new screen B-1 (1 call after the session, depth 1) and B-3 rows; each register's
  next page and filter change (1, 1); each save (1, 1, `maxRsc` 0); `@budget` on one row per plan; calls and depth block, ms report-only.
- **Tests** assert real outcomes (rows, cursors, statuses, sessions in `auth.sessions`, Mailpit messages, events in `ops.auth_events`, DOM after
  reload). One fails-without per High control (listed per plan). e2e on desktop-chrome, pixel-7, iphone-15 (golden) with 0 retries; axe 0
  serious/critical at 360, 820, 1280 (public pages also at 320). Clock cases with `page.clock` or the session time-travel helper, never sleeps.
- **UI**: V2-06 parts only; no hex or raw palette class in any touched file (the guard is per-file error for touched files from 11-01);
  `dvh`; 44 px targets below 1024; no new React Compiler waiver; the waivers owned by V2-11 (`patient-lab-documents.tsx`,
  `notifications/use-notifications.ts`) removed.
- **Affected-test discovery** before editing: `grep -rln "<the components, actions and routes the plan changes>" tests scripts`; the grep is authoritative.
- **Run order**: migration (`npx supabase db reset --local`, `npm run db:types`), service, UI, specs; affected Vitest + pgTAP, `npm run typecheck`,
  `npx eslint .`, `npm run inventory`, `npm run ci:ui-policy`, `npm run e2e:build`, the plan's e2e files, `npm run perf:latency -- --grep <rows>`.
  `npm run stack:recycle` before evidence and between executors. Local stack only; never `.env*`; synthetic data; Mailpit for email.
- **Plan record**: a section per plan in `11-NOTES.md` (changes, deviations, grep hits, commands with counts from tool output, lane rows from the
  JSON, security-sensitive files). Evidence is never typed.

## Plans

### 11-01 Registers: patients, visits, referrals (tracer) · M · migration 000150_registers

Goal: D-1, D-2. Every register is paginated in SQL with its filters in the URL.

Files: `supabase/migrations/000150_registers.sql` (`public.patients_page(p_tenant_id, p_q text, p_filters jsonb, p_cursor jsonb, p_limit)`
`patients:view`; `public.visits_page(...)` `appointments:view` with the existing filters `preset, doctor, status, specialty, search, start, end`;
`public.referrals_page(p_direction, ...)` with the referral permission; the indexes the cursors need); new
`supabase/tests/database/registers.test.sql`; `app/(dashboard)/patients/(list)/page.tsx`, `components/patients/patient-directory-table.tsx`
(rebuilt on `DataTable` + `Pagination`); `app/(dashboard)/visits/page.tsx`, `features/visits/service.ts`, `components/visits/visits-register-view.tsx`
(rebuilt; the in-memory slice deleted; `window.confirm` replaced by `AlertDialog`); `app/(dashboard)/referrals/page.tsx`,
`components/referrals/referrals-register.tsx` (rebuilt; the 05 R-35 directory toggle); `lib/pagination/url-filters.ts` (from 10-05);
new `tests/e2e/registers/{patients,visits,referrals}.spec.ts`; latency rows; loading skeletons.

1. Tracer: Patients page 1 from `patients_page` (50 rows), `?q=` search, Next → page 2 by cursor; reload keeps both.
2. Visits and referrals on the same helper; filters as `FilterChip`s; counts capped (D-1).
3. CSV export of the visits register for the current filter through the same function (server, `no-store`), if it exists today (parity).

Tests: pgTAP: grants; another clinic empty; roles (receptionist sees visits but not clinical fields; nurse; doctor; a role without
`patients:view` nothing); cursor stability under inserts between pages (no duplicate, no skip); filters equal to the old service's
results for a seeded set (parity table); search does not match on fields the role cannot see; `p_limit` capped at 100. Fails-without (High:
cross-clinic read): tenant check removed in a rolled-back transaction → clinic B rows → red; recorded. e2e: each register at three widths with
axe; filter → URL → reload → same rows; page 2 then Back. `command-latency.ts`: 20,000 patients / 50,000 visits, p95 < 80 ms per page.
Lane: `in-app.R.patients` (lowered to 1/1, `@budget`), `in-app.R.patients-next`, `in-app.R.visits`, `in-app.D.referrals`, `search.R.patients` (B-5).
Done: no register reads an unbounded set; filters live in the URL.

### 11-02 Patient profile and history; documents · M-L · migration 000151_patient_profile

Goal: D-3 to D-5, M4.6, the 08/09A/09C hand-offs. A patient opens in one round trip with deep-linkable tabs.

Files: `supabase/migrations/000151_patient_profile.sql` (`public.patient_profile(p_tenant_id, p_patient_id)` INVOKER: identity header,
allergies, AI-objection flag, consents (treatment, data sharing), counts per tab, versions; `public.patient_history_page(..., p_filters, p_cursor)`;
`public.patient_documents_page(...)`; command `void_patient_document(p_tenant_id, p_document_id, p_reason, p_client_request_id)` with
share-token revocation and audit); new `supabase/tests/database/patient_profile.test.sql`; `app/(dashboard)/patients/[id]/{layout,page}.tsx` and
`[id]/{visits,documents,billing,consent}/page.tsx` + `loading.tsx` each; new `components/patients/profile/*` (header, tabs as links, overview,
history list with filters, documents list with upload (existing FileDrop + FT-04 compression), void dialog, billing tab listing the patient's
invoices and opening the V2-10 invoice sheet, consent and DPDP export parity, allergy editor (09C), AI-objection toggle (08)); deleted:
`patient-detail-view.tsx`, `patient-visit-history.tsx`, `patient-lab-documents.tsx`, `edit-patient-modal.tsx` (replaced by an edit sheet),
`consent-section.tsx` (rebuilt); relabel in `components/consultation/workspace/attachments.tsx`, `lib/nav/*`, webhook labels;
Rx hidden for roles without `prescriptions:edit` (09C note); `tests/e2e/patients/profile.spec.ts`; latency rows.

1. Tracer: `/patients/[id]` overview from one `patient_profile` call (depth 1 after the session), `patient.view` written once (after the response,
   09E R-12), tabs as links.
2. Visits tab with paginated, filtered history; Documents tab ("Documents", upload, void with reason, voided shown struck with the reason);
   Billing tab; Consent tab with DPDP export parity.
3. Allergy editor and AI-objection toggle in the overview (confirm class); edit patient sheet.
4. Relabel sweep: `grep -rni "lab report\|labs\b" components app lib` → 0 user-facing hits (listed in notes).

Tests: pgTAP: grants, another clinic NULL, role matrix per part (receptionist: no clinical notes or diagnoses in the history rows; nurse;
doctor), void refuses without a reason and on another clinic, void revokes every share token of the document (`/r/<token>` then shows
"revoked"), void is idempotent by request id, the file remains. Fails-without (High: share link of a voided document still opens): revocation
removed in a rolled-back transaction → token still resolves → red; recorded. e2e (three projects): open a profile → one `patient.view` audit
row (database checked) across tab switches; deep link to `/patients/<id>/documents` reloads to the same tab; history filter in the URL; void a
document; axe per tab at three widths. Lane: `in-app.R.patient` (lowered to its measured value, target 1/1, `@budget`), `in-app.R.patient-visits`,
`save.D.allergies` unchanged.
Done: profile one round trip; history paginated and filtered; "Documents" everywhere; v1 profile files deleted.

### 11-03 Staff lifecycle, invites UI, owner transfer, settings regroup · M-L · migration 000152_staff_lifecycle

Goal: AUTH-05 UI, AUTH-06 UI, D-6, D-7, D-15; journey 2 / J-A2 / J-A6.

Files: `supabase/migrations/000152_staff_lifecycle.sql` (`suspend_member`, `reactivate_member`, `transfer_ownership` (D-7), each a V2-07 command
with `settings` version and audit `staff.suspended|reactivated|owner_transferred`; `public.team_page(p_tenant_id)` INVOKER: members with status,
role, last sign-in from `auth.users.last_sign_in_at` via a DEFINER helper limited to the clinic's members, pending invitations with expiry);
new `supabase/tests/database/staff_lifecycle.test.sql`; `features/staff/{actions,service,schema}.ts`; `app/(dashboard)/settings/{layout,clinic,team,schedules,plan,integrations}/**`
(moved pages; 308 redirects from `/staff`, `/settings/developer`, `/settings/billing`); new `components/settings/team/*` (member list with
Suspend, Reactivate, Remove, Change role; invitations with Resend, Revoke; invite sheet), `components/settings/schedules/*` (availability and
schedule blocks on the existing commands, 08 hand-off), macros settings (09B hand-off) under `/settings/clinic` or `/profile`;
`app/(auth)/join/page.tsx` styled (in-app-browser safe, no side effect on GET, post-success install hint); `lib/nav/nav-for-role.ts`;
`tests/e2e/auth/{j-a2-invite,j-a6-remove}.spec.ts`, `tests/e2e/journeys/journey-02-clinic-onboarding.spec.ts`, `tests/e2e/settings/team.spec.ts`.

1. Tracer: owner suspends a receptionist → the receptionist's open tab gets no data on its next action and lands on the neutral page; reactivate
   restores access.
2. Invites UI (resend rotates the token; revoke; expiry shown); styled `/join`; J-A2 via Mailpit (invite → set password → Today).
3. Remove (J-A6), change role (owner-only for admin grants, recent-auth per D-11), owner transfer (recent-auth most-sensitive; the target an
   active admin; optional step down).
4. Settings regroup with redirects; nav updated; schedule blocks page; journey 2 (create clinic → owner membership → invite → join).

Tests: pgTAP: each command's role matrix (owner; admin cannot suspend the owner or another admin; nobody suspends themselves; last-owner guard
on step down), suspended member: `authz.full_tenant_ids()` excludes the clinic, `has_permission` false, sessions per D-6 ended; transfer refuses a
non-admin and a suspended target; replay; `team_page` shows no other clinic's members and no email of a removed member. Fails-without (High:
suspended member keeps access): the status gate restored to "any membership" in a rolled-back transaction → a suspended user's read returns
rows → red; recorded. e2e: J-A2, J-A6, journey 2 (three projects, golden on iphone-15), suspend/reactivate two-context, redirects, axe at
three widths on each settings page. Lane: `in-app.O.team` (1/1, `@budget`), `in-app.O.settings-clinic`, `save.O.suspend`.
Done: an owner can invite, suspend, reactivate, remove and transfer end to end; settings follow the IA.

### 11-04 Owner TOTP, recent authentication, email change, session policy, auth events · L · migration 000153_session_policy_auth_events · split point after step 3

Goal: AUTH-08 clinic side, AUTH-09, FT-06, FT-07; D-8 to D-12, D-16.

Files: `supabase/migrations/000153_session_policy_auth_events.sql` (replace `private.session_age_token_hook` from its latest body: the 14-day
and 7-day refusals and the `sess_iat` claim (D-8); `ops.auth_events`, `ops.auth_events_overflow`, `public.log_auth_event` (closed list, actor
from `auth.uid()`), retention in `ops.cleanup()`; `public.my_last_sign_in()` DEFINER returning only the caller's `last_sign_in_at`);
new `supabase/tests/database/{session_policy,auth_events}.test.sql`; `lib/auth/recent-auth.ts` (`requireRecentAuth(level)`:
aal2 when a verified TOTP factor exists, else password `amr` ≤ 10 min, plus `session_is_live` for the most-sensitive level),
`lib/auth/sensitive-actions.ts` (D-11 list), `proxy.ts` (`sess_iat` check: 14 days → `hardSignOut('expired')`), `lib/auth/hard-sign-out.ts`,
new `lib/auth/idle.ts` + `components/shell/idle-guard.tsx` (D-9); new `app/(dashboard)/profile/security/page.tsx` (TOTP enrol with QR and
code, unenrol behind recent-auth, re-auth dialog (password + Turnstile or TOTP), owner email change with codes to both addresses,
last sign-in, Sign out everywhere); owner TOTP prompt after onboarding and at login until dismissed for 30 days (a `profiles` preference column,
or `user_metadata` if no column is needed); `features/auth/*` (event writes at sign-in, sign-out all, password change, re-auth, email change, MFA
enrol/unenrol); `lib/email/templates/auth.ts` (D-16); new `tests/helpers/totp.ts` (D-12); `tests/e2e/auth/{j-a7-idle,j-a11-owner-totp,session-policy,email-change}.spec.ts`.

1. Tracer: an owner enrols TOTP; a role grant then asks for a TOTP code (aal2) and succeeds with the helper's code; without it the action
   refuses with `RECENT_AUTH_REQUIRED` (server-side, not only UI).
2. `requireRecentAuth` on every D-11 action (guard engine asserts each listed action calls it); unenrolled owners: password within 10 min or
   the re-auth dialog.
3. Owner email change (Supabase secure change, codes to both addresses in Mailpit, audit `auth.email_changed`, notification email); staff copy:
   "ask the owner to remove and re-invite you". **Split point.**
4. Session policy (D-8): hook refusals and `sess_iat`; proxy check; time-travel helper moves `auth.sessions.created_at/refreshed_at` on the local
   stack only (test helper under `tests/`, loopback guard).
5. Idle sign-out (D-9) on consult, profile and Rx screens; Today exempt.
6. Auth events written for the §4.5 list; retention and cap; last sign-in shown; Sign out everywhere ends every session (`auth.sessions` empty
   for the user) and writes `auth.sign_out_all`.

Tests: pgTAP: the hook refuses at 14 days + 1 s and at 7 days + 1 s idle, issues at the boundary − 1 s, adds `sess_iat`; `log_auth_event`
refuses unknown events and another user's id; retention removes rows older than 180 days and keeps 179; the cap counts overflow; no grant on
`ops.*` to `authenticated`/`anon`; `my_last_sign_in` returns only the caller's. Fails-without (High: an expired session keeps working): hook
body restored in a rolled-back transaction → a 15-day session refreshes → red; recorded. Fails-without (High: sensitive action without
re-auth): the guard call removed from `transferOwnership` → the guard engine spec fails; recorded. Vitest: `recent-auth.spec.ts` matrix (aal1
with factor → refuse; aal2 → allow; no factor + password 9 min → allow, 11 min → refuse; most-sensitive with a dead session → refuse). e2e:
J-A11 (enrol, sign out, sign in asks for the code, role grant with aal2), J-A7 (clock advanced 10 min on consult → `/login?email=`, PHI covered;
Today not signed out), session-policy (time-travel 15 days → next navigation lands on `/login`; 8 idle days → refresh refused → `/login`),
email change via Mailpit, Sign out everywhere across two contexts; axe on the security page at three widths.
Lane: `in-app.O.profile-security` (1/1); no row of an existing screen may rise (the proxy check uses claims only: proof is the unchanged
`@budget` rows).
Done: owners can enrol TOTP and sensitive actions need aal2 once enrolled; 14-day and 7-day rules enforced by the app on Free; auth events
kept 180 days.

### 11-05 Public token pages, PWA entries, journey 10 · M · no migration

Goal: M4.7 public pages, the PWA entries, D-14.

Files: `app/r/[token]/page.tsx`, `app/reschedule/[token]/page.tsx`, `app/reports/view/page.tsx` (and their components) rebuilt on V2-06 parts
(clinic name, state messages, "Call clinic" link, no raw palette, 320 px first; no PHI beyond what each page shows today: the reviewer checks
field by field); `/join` (done in 11-03) re-checked at 320; `app/(dashboard)/profile/page.tsx` "Install app" and "Check for updates" entries
(`lib/pwa/update.ts`, `install-entry.tsx`) and a desktop "Check for updates" in the user menu; new `tests/e2e/public/{share-link,reschedule,report-view}.spec.ts`,
`tests/e2e/journeys/journey-10-patient-messaging.spec.ts`, `tests/e2e/pwa/profile-entries.spec.ts`.

1. Tracer: `/r/<token>` for a prescription at 320 px passes axe and shows the verification state; the revoked token shows "revoked" with Call clinic.
2. Reschedule and report view pages; every state (invalid, expired, revoked, clinic unavailable, success) has a case.
3. Profile entries; "Check for updates" triggers `checkForWorkerUpdate` and shows the toast or "You're up to date".
4. Journey 10 (D-14): book → outbox row → jobs runner run locally (the e2e jobs endpoint with the local runner secret) → fake provider records
   the send → signed DLR POST → the visit's message status reads "Delivered".

Tests: e2e at 320, 360, 820, 1280 with axe 0 for every public state; no `Set-Cookie` and `no-store` on public responses (existing headers
asserted); a token from clinic A never renders clinic B data; journey 10 on desktop-chrome and pixel-7. Lane: `full.P.share-link` (calls and
depth at baseline).
Done: public pages pass axe at 320; Profile has Install and Check for updates; journeys 2 (11-03) and 10 green.

### 11-06 M5 cleanup and enforcement · M · no migration

Goal: M5, D-17, X-2, X-4. No v1 component remains; the palette reset is on; every UI guard blocks.

Files: `scripts/ui/palette-codemod.mjs` (new; mapping table in the script header reviewed against DESIGN_SYSTEM tokens), every file it touches;
`app/globals.css` (`--color-*: initial` palette reset); `scripts/ci/ui-policy-baseline.json` (emptied) and the rule modes (report → error);
`eslint.config.mjs` (jsx-a11y → error); `scripts/ci/react-compiler-waivers.json` (V2-11-owned waivers removed); deleted v1 components
(the list generated by `node scripts/ui/v1-orphans.mjs`: files under `components/**` not imported by any route after 11-01..05, plus the v1
adapters' legacy props in `components/ui/{badge,button,modal,field,select,phone-input}.tsx` once unused); `docs/temp/free-nextjs-admin-dashboard-main`
removed; `window.confirm`/`alert` sites → `AlertDialog`; `<Link><Button>` → `Button asChild`; sub-12 px text → type scale tokens.

1. Tracer: the codemod on one directory (`components/settings/developer`) → 0 raw-palette hits there, screenshots unchanged in intent,
   axe clean; committed alone.
2. Codemod over the tree; manual fixes for unmapped hits, px-font (266), link-wraps-button (30), window-dialog (27), arbitrary-color (2).
3. Orphan deletion (generated list in the notes with each file's importer count = 0); palette reset on; guards and jsx-a11y to error.
4. Full PR lane once; axe across every route (`tests/e2e/a11y/*`) at three widths; the g3 screen screenshots before/after attached.

Tests: `npm run ci:ui-policy` exits 0 with every rule at error and an empty baseline; `npx eslint .` 0 errors; the a11y suite 0 serious/critical;
the full PR lane green with 0 retries. Fails-without: a raw-palette class added to a scratch file makes `ci:ui-policy` exit 1 (recorded,
removed). Bundle budgets unchanged (report-only, X-2).
Done: M5 acceptance met except bundle budgets (V2-15).

### 11-07 Review fixes · S · migration 000154 only if a fix needs SQL

Isolated reviewer (Sonnet) and adversarial reviewer (Opus), fresh context, given the phase diff and this plan's DECISIONS only. Highs and
Mediums fixed with a test that fails without the fix; Lows cheap and local or to the backlog; Highs re-checked once.

### Close

1. Evidence: `npm run stack:recycle`; `node scripts/phase-evidence.mjs .planning/phases/11-profile-registers-settings/evidence 1`; push; CI green
   with 0 retried tests; `--ci-run <id>`; copy the `perf-latency` summary, `command-latency.json`, the axe report and the deletion diff stat.
2. Docs (Haiku): `11-SUMMARY.md`, `11-VERIFICATION.md`, `.planning/ROADMAP.md`, the master roadmap status line and X-3 wording, doc amendments,
   VERIFICATION_LOG entry (CI link, SHA), PO-ACTIONS `11-P1..P3`.
3. Gate: PO or Claude under the delegated authority; merge on green.

## Acceptance (roadmap §12 V2-11) → proof

| Criterion | Proof |
|---|---|
| Registers paginated server-side | `registers.test.sql` cursor cases; e2e filter/URL/reload; lane next-page rows (11-01) |
| Public token pages pass axe at 320 px | `tests/e2e/public/*` at 320 (11-05) |
| Owner invites, suspends, removes staff end to end (Mailpit, set password, sign in) | J-A2, J-A6, suspend two-context e2e, journey 2 (11-03) |
| Owner enrols TOTP; sensitive actions need aal2 once enrolled | J-A11; `recent-auth.spec.ts`; guard engine; fails-without (11-04) |
| Session > 14 days or idle > 7 days signed out by the app (time-travel) | `session_policy.test.sql`; `session-policy.spec.ts`; fails-without (11-04) |
| Every remaining v1 component deleted | orphan list = 0; deletion diff; ui-policy at error with empty baseline (11-06) |
| Journeys 2 and 10 | `journey-02-*`, `journey-10-*` (11-03, 11-05) |

## Threat register (STRIDE)

| ID | Cat. | Component | Sev. | Mitigation |
|---|---|---|---|---|
| T-11-01 | I | Register reads and search | high | INVOKER, permission per role, field allow-list, 100-row cap, cross-clinic fails-without |
| T-11-02 | I | `patient_profile`, history, documents | high | per-part role matrix; `patient.view` once per opening; no prefetch; `no-store` |
| T-11-03 | E | Suspend / remove / transfer | high | role matrix, self and last-owner guards, recent-auth on grants and transfer, status gate fails-without |
| T-11-04 | S | Session policy bypass | high | refusal in the token hook (server), `sess_iat` in proxy, fails-without |
| T-11-05 | S / E | Sensitive actions without re-auth | high | `requireRecentAuth` server-side, guard engine asserts every D-11 action, fails-without |
| T-11-06 | S | TOTP enrol/unenrol abuse | medium | unenrol behind recent-auth; factor emails (D-16); lost factor only via platform admin (V2-13c) |
| T-11-07 | T / I | Owner email change | medium | Supabase secure change (both addresses), most-sensitive re-auth, audit, notification |
| T-11-08 | I | `ops.auth_events` | medium | closed lists, coarse UA class only, no IP stored, no grants, 180-day retention, cap |
| T-11-09 | I | Public token pages | high | unchanged token checks; fields reviewed one by one; another clinic never; `no-store`; voided documents' tokens revoked |
| T-11-10 | D | Idle sign-out on shared devices | low | 10-min timer, PHI cover on hide, Today exempt by design |
| T-11-11 | T | Codemod changing behaviour | medium | mapping table reviewed; screenshots before/after; axe and full PR lane |

## Security-sensitive files (adversarial review list)

`supabase/migrations/000150_registers.sql`, `000151_patient_profile.sql`, `000152_staff_lifecycle.sql`, `000153_session_policy_auth_events.sql`
(and 000154 if any) with their pgTAP files; `proxy.ts`; `lib/auth/{recent-auth,sensitive-actions,hard-sign-out,idle}.ts`;
`features/staff/*`, `features/auth/*`; `app/(dashboard)/profile/security/**`; `app/(auth)/join/**`; `app/r/**`, `app/reschedule/**`,
`app/reports/view/**`; `tests/security/guard-manifest.ts` and the guard engine; `tests/helpers/{totp,session-time-travel}.ts` (loopback only).

## Doc amendments (applied at the close)

| # | Document | Amendment |
|---|---|---|
| A-1 | INFORMATION_ARCHITECTURE | URL moves to `/records/*` and the consult route deferred to v2.1 (X-1) |
| A-2 | FRONTEND_MIGRATION_PLAN M5 | bundle budgets blocking at V2-15 per PWA_STRATEGY (X-2); jsx-a11y at error (X-4) |
| A-3 | V2_MASTER_ROADMAP V2-11 tests | "MFA (J-A11)", "idle sign-out (J-A7)" (X-3) |
| A-4 | AUTH_REDESIGN §3.6 / FT-06 | session policy enforced in the access-token hook plus a claim (D-8); J-A11 added |
| A-5 | DATA_HANDLING §2, §5 | `ops.auth_events`: user id, event, coarse UA, 180 days (D-10) |

## Hand-offs

- V2-12: messaging governance builds on journey 10's path; API keys/webhooks pages already behind recent-auth.
- V2-13 (DPDP): erasure covers `ops.auth_events` by user id.
- V2-13c: platform-admin TOTP (J-A8) and lost-factor reset (`deleteFactor`).
- V2-14: `no-explicit-any` sweep; bundle budgets blocking at V2-15.
- v2.1: `/records/*` URL moves (X-1); structured labs (P2-13).

## PO external actions

- `11-P1`: staging migrate of 000150-000153 (not delegated); then a 15-minute walkthrough (invite a receptionist to a real inbox via Resend,
  suspend and reactivate, enrol TOTP on the owner, a patient profile with documents, the registers on a phone).
- `11-P2`: PO-ACTIONS 2.2 (Resend for invite and auth emails on staging) must be done before 11-P1's invite step.
- `11-P3`: on staging, confirm in Supabase → Authentication that TOTP MFA is enabled and "secure email change" is on (read-only check; Claude
  prints the exact settings with `node scripts/ci/check-auth-config.mjs --print staging`).

## Out of scope

Platform-admin TOTP and factor reset (V2-13c); SMS or WebAuthn factors; recovery codes (AUTH §4.6: none); per-branch screens (v2.1);
`/records/*` URL moves (X-1); structured labs; bundle budgets blocking (V2-15).

## Execution (lean process; deadline 6 Dec)

- One Opus executor, plans in order, about one day for the phase (11-04 and 11-06 are the long ones; split points named); `npm run stack:recycle`
  between plans. Never set a mode when starting a subagent.
- Affected tests only per plan; the full PR lane once after 11-04 and once in 11-06; CI runs everything; one evidence run.
- Reviews: Sonnet isolated, Opus adversarial, one fix round; docs by Haiku.
- Branch `v2/phase-11-profile-registers-settings` off `feature/v2` after the V2-10 merge; never `main`; no force-push; local stack only.
