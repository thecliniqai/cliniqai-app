# Plan 01-03: Staff Invitations, Server-Side RBAC, Clinic Profile & Subscription Visibility Summary

## Execution Overview
- **Phase**: 01-foundation-tenant-isolation
- **Plan**: 03
- **Status**: Completed successfully
- **Commit Baseline**: Migration `000002_invitations_billing.sql`, RBAC matrix, staff invitations & OTP join flows, clinic profile management, subscription RLS visibility, and full suite integration tests.

## What Was Delivered
1. **Database & Migrations (`000002_invitations_billing.sql`)**:
   - `tenants`: extended with `address`, `specialties`, `working_hours`, and `timezone`.
   - `invitations`: single-use tokens with `token_hash`, `expires_at`, `consumed_at`, and `consumed_by`.
   - `subscriptions` & `payment_records`: strict RLS policies restricting read to Owner/Admin only.
   - `consume_invitation(token_hash)`: atomic security-definer function verifying unconsumed/unexpired status under a row lock (`FOR UPDATE`) and inserting membership.

2. **Server-Side Authorization & RBAC**:
   - `lib/permissions/matrix.ts`: role permissions mapped for `owner`, `admin`, `doctor`, `receptionist`, `nurse`. Owner holds the wildcard (`*`), clinical write is restricted to doctors, and doctor's set is not a superset of receptionist/nurse.
   - `lib/permissions/index.ts`: pure `hasPerm` and `assertPerm`.
   - `lib/permissions/guards.ts`: `requirePermission` server guard resolving tenant context and enforcing permission boundaries before mutations/queries.

3. **Staff & Team Management Flow**:
   - `features/staff/invite.ts`: cryptographically secure token generation (SHA-256 hash stored; raw token in URL only).
   - `features/staff/actions.ts`: server actions `inviteStaff` and `acceptInvite`.
   - `app/(dashboard)/staff/page.tsx`: staff listing and invite form with progressive disclosure.
   - `app/(auth)/join/page.tsx`: invitee landing page supporting email OTP verification and atomic invitation consumption wrapped in a Suspense boundary.

4. **Clinic Profile & Subscription Management**:
   - `features/clinics/profile.ts` & `features/clinics/constants.ts`: profile service supporting multi-specialty selection and timezone rules.
   - `features/billing/subscription.ts`: read-only billing service fetching active plan and payment history under RLS.
   - `app/(dashboard)/settings/clinic/page.tsx`: profile editing interface.
   - `app/(dashboard)/settings/billing/page.tsx`: subscription status, plan amount, renewal date, and payment history.
   - `components/dashboard/nav.tsx` & `app/(dashboard)/layout.tsx`: responsive navigation and dashboard shell.

5. **Test Verification**:
   - `tests/auth/rbac.spec.ts` (5 tests): verifies owner wildcard, admin non-clinical scope, doctor boundaries, and non-superset separation.
   - `tests/auth/invite.spec.ts` (5 tests): verifies owner/admin invite insert under RLS, non-admin rejection, atomic invite consumption, replay rejection, and expiry rejection.
   - `tests/integration/subscription.spec.ts` (3 tests): verifies owner access, doctor zero-row boundary under RLS, and cross-tenant zero-row isolation.
   - `tests/integration/multi-tenancy.spec.ts` (6 tests): baseline tenant isolation verified.
   - Total test suite: 19/19 passing.

## Verification Results
- `npm run lint`: Passed (0 warnings, 0 errors).
- `npm run typecheck`: Passed (clean strict mode).
- `npm run build`: Passed (11 static/dynamic pages compiled cleanly).
- `npx vitest run`: 19 passed across 4 test suites.
