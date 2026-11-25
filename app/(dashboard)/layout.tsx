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
import { HydrationBoundary } from "@tanstack/react-query";
import { SessionShell } from "@/components/shell/session-shell";
import { FrontDeskSheets } from "@/components/front-desk/front-desk-sheets";
import { hasPerm } from "@/lib/permissions";
import { MembershipEnded } from "@/components/shell/membership-ended";
import { ClinicPicker } from "@/components/shell/clinic-picker";
import { listUserClinics } from "@/features/clinics/switch";
import { serverEnv } from "@/lib/env-server";
import { QueryProvider, QueryScreens } from "@/lib/query/provider";
import { createRequestQueryClient, dehydrateRequest } from "@/lib/query/server";
import { queryKeys } from "@/lib/query/keys";
import { createClient } from "@/lib/supabase/server";
import { clinicLabel } from "@/features/session/view";
import { readSessionBootstrap } from "@/features/session/queries";
import { BootstrapLiveBasis, SessionBootstrapScope } from "@/lib/session/use-bootstrap";
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

  // V2-09e 09E-13 (R-13): the session bootstrap is read as soon as the clinic is known, beside the membership and access checks, never after them (the
  // depth of a full load stays as it was). The device's pinned clinic is the clinic in almost every load, so its read starts now; the function answers only
  // for an active member (NULL otherwise), and it is used only when the session resolves to that same clinic.
  const pinned = await readActiveClinicCookie();
  const bootstrapDb = await createClient();
  const pinnedBootstrap = isClinicId(pinned) ? readSessionBootstrap(bootstrapDb, pinned.toLowerCase()) : null;

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
  const bootstrapRead =
    pinnedBootstrap && isClinicId(pinned) && pinned.toLowerCase() === membership.tenantId.toLowerCase()
      ? pinnedBootstrap
      : readSessionBootstrap(bootstrapDb, membership.tenantId);
  const [accessLevel, bootstrap] = await Promise.all([getTenantAccessLevel(membership.tenantId), bootstrapRead]);
  const destination = accessRedirect(membership.role, accessLevel);
  if (destination) {
    redirect(destination);
  }

  // V2-09e 09E-13 (R-13): the session bootstrap (the clinic's name and zone, the role for the navigation, the doctor directory, the user's clinics for the
  // switcher, the Rx print display fields and the `settings` version of the same statement), one `session_bootstrap` call. It replaces the membership read
  // this layout made for the switcher (V2-08 08-05), so a full load makes the same number of calls at the same depth. It is handed to the client's bootstrap
  // query (`HydrationBoundary`), which the shell and the screens read for the rest of the session; a layout render after a refresh hands over a newer one.
  // A failed read shows what the session knows (the role) and "Clinic", as the failed switcher read did, and the client reads it again.
  const queryClient = createRequestQueryClient();
  if (bootstrap) queryClient.setQueryData(queryKeys.bootstrap(membership.tenantId), bootstrap);

  // 06-09d (M-REMOVED-R1): no clinic pinned on this device yet: the shell's first status check pins this one.
  const shellClinic = isClinicId(pinned) ? null : membership.tenantId;

  // Every client component below reads the clinic's zone from the shell (V2-03 03-05; from the bootstrap since 09E-13); the browser zone is never used.
  // V2-06 06-05: the PWA runtime (service worker, offline banner) runs only in the signed-in shell; `next dev` never
  // registers the worker (its chunks are not content-hashed, so caching them would serve stale code).
  // V2-09e 09E-03 (R-14): the tab's one client data layer (memory only, cleared at sign-out, lock and clinic switch) wraps the shell (09E-13: the shell reads
  // the bootstrap from it); the screens inside stop rendering once it is cleared (`QueryScreens`).
  // V2-09e 09E-04 (R-18): the live provider inside it owns the clinic's one Realtime channel, the heartbeat and the versions the screens converge on.
  // V2-09e 09E-09 (R-5): the global reference catalogues the role may read are kept on the device (IndexedDB `cliniq-reference`, catalogue rows only).
  // V2-06 06-04b: the app shell. The navigation model is derived from the role the server resolved (the session, then the bootstrap's read of the
  // database: display and navigation only, R-13) and the permission matrix (`navForRole`, T-06-16). The pages keep their own guards.
  return (
    <QueryProvider>
      <HydrationBoundary state={dehydrateRequest(queryClient)}>
        <SessionBootstrapScope tenantId={membership.tenantId}>
          <SessionShell
            fallback={{
              clinicName: clinicLabel(null),
              role: membership.role,
              zone: null,
              clinics: [],
            }}
            email={claims.email || ""}
            swEnabled={serviceWorkerEnabled()}
            shellClinic={shellClinic}
            activeClinicId={membership.tenantId}
          >
            <QueryScreens>
              <LiveProvider tenantId={membership.tenantId}>
                <BootstrapLiveBasis settings={bootstrap?.versions.settings ?? null} />
                <ResumeRefresh />
                <ReferenceSync catalogues={DEVICE_CATALOGUES.filter((c) => hasPerm(membership.role, CATALOGUE_PERMISSION[c]))} />
                {children}
                <FrontDeskSheets
                  canRegister={hasPerm(membership.role, "patients:edit")}
                  canWalkIn={hasPerm(membership.role, "appointments:edit")}
                  canBook={hasPerm(membership.role, "appointments:edit")}
                />
              </LiveProvider>
            </QueryScreens>
          </SessionShell>
        </SessionBootstrapScope>
      </HydrationBoundary>
    </QueryProvider>
  );
}
