import { redirect, unstable_rethrow } from "next/navigation";
import {
  ActiveClinicMembershipEndedError,
  getActiveMembership,
  getSessionClaims,
  getTenantAccessLevel,
  isClinicId,
  MultipleClinicsSelectionRequiredError,
  NoClinicMembershipError,
  readActiveClinicCookie,
  UnauthenticatedError,
  type SessionClaims,
} from "@/lib/auth/tenant";
import { accessRedirect } from "@/lib/auth/access-redirect";
import { redirectIfUnauthenticated } from "@/lib/auth/page";
import { AppShell } from "@/components/shell/app-shell";
import { FrontDeskSheets } from "@/components/front-desk/front-desk-sheets";
import { hasPerm } from "@/lib/permissions";
import { MembershipEnded } from "@/components/shell/membership-ended";
import { ClinicPicker } from "@/components/shell/clinic-picker";
import { listUserClinics } from "@/features/clinics/switch";
import { navForRole } from "@/lib/nav/nav-for-role";
import { resolveTimeZone } from "@/lib/datetime";
import { ClinicTimeZoneProvider } from "@/lib/datetime/client";
import { serverEnv } from "@/lib/env-server";
import { QueryProvider } from "@/lib/query/provider";
import { ResumeRefresh } from "@/components/shell/resume-refresh";
import { LiveProvider } from "@/lib/live/provider";
import { ReferenceSync } from "@/components/shell/reference-sync";
import { CATALOGUE_PERMISSION, DEVICE_CATALOGUES } from "@/features/reference/catalogues";

/**
 * V2-06 06-05: the worker never registers under `next dev`. 06-09a (IND L-5): an environment the schema refuses makes
 * `serverEnv()` throw; that must cost only the worker, not every dashboard page (as for every other Wave A caller).
 */
function serviceWorkerEnabled(): boolean {
  try {
    return serverEnv().APP_ENV !== "development";
  } catch {
    return false;
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // V2-09d: the session from the verified JWT claims, once per request (no Supabase Auth round trip; the proxy has refreshed
  // the session already). `/api/session-status`, which the shell calls on load, asks Supabase Auth for a fresh answer.
  let claims: SessionClaims;
  try {
    claims = await getSessionClaims();
  } catch (error) {
    // 09D-01a (A-7): only a missing or unverifiable session goes to sign-in. Next's own control flow is rethrown; V2-06
    // 06-09c (H-AUTHOUT) Auth could not answer (network, timeout, 5xx, 429) and any other failure is not a missing session:
    // the error boundary offers Retry (and `onRequestError` records it), never a silent trip to /login.
    unstable_rethrow(error);
    if (error instanceof UnauthenticatedError) redirect("/login");
    throw error;
  }

  let membership;
  try {
    membership = await getActiveMembership();
  } catch (error) {
    if (error instanceof NoClinicMembershipError) {
      redirect("/clinic/new");
    }
    // 06-09c (M-REMOVED): the clinic this device had open is no longer one of the user's clinics. On a full load the
    // shell (and its session-status watch) never renders, so the device is signed out and purged from here. 06-09d
    // (L-R4): also when it was the user's last clinic (the device's pinned clinic tells a removal from a new account).
    if (error instanceof ActiveClinicMembershipEndedError) {
      return <MembershipEnded />;
    }
    // V2-08 08-05 (P1-12, R-17): two or more clinics and none chosen on this device: pick one (the switcher's cookie), no error page.
    if (error instanceof MultipleClinicsSelectionRequiredError) {
      return <ClinicPicker clinics={(await listUserClinics()).map(({ id, name, role }) => ({ id, name, role }))} />;
    }
    // V2-08 08-06a: the session ended between the check above and this one (a sign-out in flight on this device, e.g. the
    // shell's session-status watch): sign-in, as the wrapped pages do, never the error page.
    redirectIfUnauthenticated(error);
    throw error;
  }

  // V2-05 05-10b (SUB-02, SUB §7.2 item 3): a clinic without full access sees only its locked or onboarding page
  // (`lib/auth/access-redirect.ts`: owner/admin → /billing/locked, other roles → /billing/locked/staff, onboarding →
  // /onboarding/billing). The level comes from the database (`my_tenant_access`); a lookup failure throws (fail
  // closed). This is the UX on top of the database stop (RLS, storage, definer RPCs and guards, 05-10a), not the
  // control itself. The destinations are outside this layout, so they never loop, and the proxy does not query the
  // database (SUB §7.2 item 5): PWA assets and every non-dashboard path are never redirected by this rule.
  const destination = accessRedirect(membership.role, await getTenantAccessLevel(membership.tenantId));
  if (destination) {
    redirect(destination);
  }

  // The user's clinics for the switcher (V2-08 08-05), with the active clinic's name and zone: one membership read per
  // request, shared with the membership resolution when that read the database (V2-09d).
  const clinics = await listUserClinics();
  const activeClinic = clinics.find((c) => c.id.toLowerCase() === membership.tenantId.toLowerCase());

  // 06-09d (M-REMOVED-R1): no clinic pinned on this device yet: the shell's first status check pins this one.
  const shellClinic = isClinicId(await readActiveClinicCookie()) ? null : membership.tenantId;

  // Every client component below reads the clinic's zone from here (V2-03 03-05); the browser zone is never used.
  // V2-06 06-05: the PWA runtime (service worker, offline banner) runs only in the signed-in shell; `next dev` never
  // registers the worker (its chunks are not content-hashed, so caching them would serve stale code).
  // V2-09e 09E-03 (R-14): the tab's one client data layer (memory only, cleared at sign-out, lock and clinic switch) wraps the screens.
  // V2-09e 09E-04 (R-18): the live provider inside it owns the clinic's one Realtime channel, the heartbeat and the versions the screens converge on.
  // V2-09e 09E-09 (R-5): the global reference catalogues the role may read are kept on the device (IndexedDB `cliniq-reference`, catalogue rows only).
  // V2-06 06-04b: the app shell. The navigation model is resolved HERE, from the session's role and the permission
  // matrix (`navForRole`, T-06-16); the client only renders it. The pages keep their own guards.
  return (
    <ClinicTimeZoneProvider timeZone={resolveTimeZone(activeClinic?.timeZone)}>
      <AppShell
        model={navForRole(membership.role)}
        clinicName={activeClinic?.name || "Clinic"}
        user={{ email: claims.email || "", role: membership.role }}
        swEnabled={serviceWorkerEnabled()}
        shellClinic={shellClinic}
        clinics={clinics.map((c) => ({ id: c.id, name: c.name }))}
        activeClinicId={membership.tenantId}
      >
        <QueryProvider>
          <LiveProvider tenantId={membership.tenantId}>
            <ResumeRefresh />
            <ReferenceSync catalogues={DEVICE_CATALOGUES.filter((c) => hasPerm(membership.role, CATALOGUE_PERMISSION[c]))} />
            {children}
            <FrontDeskSheets
              canRegister={hasPerm(membership.role, "patients:edit")}
              canWalkIn={hasPerm(membership.role, "appointments:edit")}
              canBook={hasPerm(membership.role, "appointments:edit")}
            />
          </LiveProvider>
        </QueryProvider>
      </AppShell>
    </ClinicTimeZoneProvider>
  );
}
