# V2-11 research notes (inventory at c609907a, read-only; re-check line numbers at execution)

## Registers and profile
- Patients list `app/(dashboard)/patients/(list)/page.tsx:13-36` reads every patient; client filter `patient-directory-table.tsx:45-67` (":47 V2-11 paginates it").
- Profile `app/(dashboard)/patients/[id]/page.tsx`: awaits `getPatientWithVersions`, `getActiveMembership`, two `getCurrentConsent`; history streamed
  (`features/patients/actions.ts:83`); `patient-detail-view.tsx` (658 lines, v1 tabs :89, :322-392), `patient-visit-history.tsx`, `patient-lab-documents.tsx`
  (fetch on mount; React Compiler waiver owned by V2-11), `edit-patient-modal`, `dpdp-export-actions`, `consent-section.tsx`.
- Visits register `app/(dashboard)/visits/page.tsx:16-65` (URL params, pageSize 25); `features/visits/service.ts:261` fetches all, slices :300-304.
- Referrals `app/(dashboard)/referrals/page.tsx`: everything, no params. IA target `/records/*` (INFORMATION_ARCHITECTURE.md:23, :28).

## Settings, staff, auth
- Settings: `settings/clinic`, `settings/billing` (subscription), `settings/developer`; `/profile`; `/staff` (`app/(dashboard)/staff/page.tsx:22-39`);
  nav `lib/nav/nav-for-role.ts:141-163`; IA target `/settings/{clinic,team,schedules,plan,integrations}` (IA:120-126).
- AUTH-05: `public.remove_member` (000087:254, 000092) deletes `auth.sessions` (:342); `memberships.status 'suspended'` reserved (000087:50); no suspend
  function; `authz.*` read only active memberships (000087:11, :90, :97); `session_is_live()` (000087) via `lib/auth/session-live.ts`.
- AUTH-06: 000088/000089 functions; actions `features/staff/actions.ts` (`inviteStaff` :52, `acceptInvite` :148, `resendInvite` :212, `revokeInvite` :224);
  `/join` minimal (`app/(auth)/join/page.tsx:12`, 05 R-31).
- Owner transfer: only `change_member_role` (000019, 000087) via `features/settings/service.ts:486`. Email change: email template only
  (`app/api/auth/send-email/route.ts:189-195`).
- MFA: `supabase/config.toml:80` TOTP on; no `auth.mfa` use, no aal2, no `requireRecentAuth`. `lib/auth/session-age.ts` (amr, 600 s mailbox bound);
  `lib/auth/sensitive-actions.ts:23-55` closed list (the hook).
- Session: `jwt_expiry=900` (config.toml:20); access-token hook `private.session_age_token_hook` (config.toml:94-96, 000030); `hardSignOut`
  (`lib/auth/hard-sign-out.ts:41, :259`, reason `idle` without a timer); "Sign out of all devices" (`components/shell/user-menu.tsx:74, :152`);
  `proxy.ts:284` mailbox age only; `auth.sessions` columns confirmed in `01A-04-AUTH00-SPIKE.md:197` (`refreshed_at` timestamp without tz).
- Auth events: log lines only (`features/auth/service.ts:84-173`); `audit_logs.tenant_id NOT NULL` (000003:27); 180-day purge pattern `ops.purge_error_events` (000028:261).
- AUTH_REDESIGN: §3.2 invites, §3.5 requireRecentAuth, §3.6 AUTH-D2 session rules and idle sign-out, §3.7 email change and owner transfer,
  §4.5 events, §4.6 owner TOTP (aal2 list), §0/§4.1 Free-plan gaps (time-box, inactivity Pro-only; auth logs 1 h), J-list :483.

## Labs naming
`patient-detail-view.tsx:89, :381-390, :627`; `patient-lab-documents.tsx:96, 106, 109, 250, 282, 310, 315, 413, 515`;
`consultation/workspace/attachments.tsx:113`; `settings/developer/webhook-subscription-list.tsx:105`. Document void: 000110:5, :41 (09A Q-5, T-09A-11).

## Public pages and PWA
`lib/auth/public-paths.ts:14-29`; `app/r/[token]/page.tsx` (kinds: patient_document, prescription, invoice, referral; `features/sharing/public-links.ts:25`);
`app/reschedule/[token]/page.tsx` (fetches `/api/reschedule/[token]`); `app/reports/view/page.tsx?token=`. Raw-palette hits: r 10, reschedule 13, join 12.
Install / Check for updates in `components/shell/more-sheet.tsx:26, :96, :109-113`, `user-menu.tsx:120`, `lib/pwa/update.ts:93`; Profile entries missing (PWA_STRATEGY:473).

## M5
FRONTEND_MIGRATION_PLAN.md:177-198. ui-policy report-only counts (baseline `scripts/ci/ui-policy-baseline.json`): raw-palette 3,334, px-font 266,
link-wraps-button 30, window-dialog 27, arbitrary-color 2; enforced: brand-utility, signout-guard, screen-height, mono-font. ESLint warn:
`no-explicit-any` (eslint.config.mjs:689), jsx-a11y (:650-660). Heaviest files: patient-detail-view 76, visits-register-view 73, referrals-register 69,
create-referral-modal 66, patient-lab-documents 59, patient-visit-history 57, pediatrics-tools 51, dental-odontogram 51, read-only-encounter-modal 40,
doctor-availability-card 38, vitals-block 36, clinic-showcase-panel 33, settings/developer ~70. v1-prop adapters: badge, button, modal, field, select, phone-input.
Palette reset absent (`app/globals.css:27` note). Bundle budgets blocking at V2-15 (PWA_STRATEGY:455).

## Journeys
`tests/e2e/journeys`: 01, 03, 04, 05, 06, 08, 09. TEST_STRATEGY §7: 2 clinic onboarding, 7 billing, 10 patient messaging (MSG91 stub + DLR).
Auth specs present: j-a3, j-a4, j-a5, join-invite, signout, turnstile, send-email-hook. Mailpit helpers `tests/e2e/support/password-journeys.ts:125-140`.
Messaging webhook route `app/api/webhooks/messaging/[provider]/route.ts`. No `otplib` in package.json (`msw` 3.0.3 present).

## Hand-offs collected
05-PLAN:1722 (R-31), :1726 (R-35 referral directory toggle); 05b-SUMMARY:149; 08-PLAN:328-329, :336 (profile, AI objection, directory pagination,
schedule blocks page, journey 2); 08-REVIEW-TRIAGE:16 A-9; 09A-PLAN:248, :270, :284 (document void); 09B-PLAN:556 (route moves, macros page);
09C-PLAN:495 (allergy editor in the profile, logo upload), 09C-NOTES:85 (hide Rx without `prescriptions:edit`); 06-PLAN:1512, :1637, :1730
(Profile install entries, idle leg); 06-WAVE-NOTES:92 (v1 dialogs without focus trap); 03-SUMMARY:121 (MFA factor emails).
VERIFICATION_LOG: PO-5 (:339), PO-15 (:347), C32 (:234), R13 (:294), FT gaps (:437), delegation V2-07..V2-11 merges (:924).
