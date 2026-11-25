"use client";

import { useMemo } from "react";
import type { UserRole } from "@/lib/db/types";
import { clinicLabel, switcherClinics } from "@/features/session/view";
import { resolveTimeZone } from "@/lib/datetime";
import { ClinicTimeZoneProvider } from "@/lib/datetime/client";
import { navForRole } from "@/lib/nav/nav-for-role";
import { useSessionBootstrap } from "@/lib/session/use-bootstrap";
import { AppShell } from "./app-shell";

/**
 * The shell from the session bootstrap (V2-09e 09E-13, R-13): the clinic's name, its zone (every client component's "today" and date formatting), the role
 * the navigation and the user block show, and the user's clinics for the switcher, all from the bootstrap query, so a rename, a zone change or a role change
 * made on another device reaches this tab with the clinic's `settings` version, without a reload. The layout's own read hydrates it on a full load; until
 * a bootstrap is held (its read failed) the server's values are shown. The role here is for display and navigation only: every page and command checks it
 * again on the server and in the database.
 */
export function SessionShell({
  fallback,
  email,
  swEnabled,
  shellClinic,
  activeClinicId,
  children,
}: {
  fallback: { clinicName: string; role: UserRole; zone: string | null; clinics: { id: string; name: string }[] };
  email: string;
  swEnabled: boolean;
  shellClinic: string | null;
  activeClinicId: string;
  children: React.ReactNode;
}) {
  const bootstrap = useSessionBootstrap();
  const role = bootstrap?.role ?? fallback.role;
  const model = useMemo(() => navForRole(role), [role]);
  const clinics = useMemo(() => (bootstrap ? switcherClinics(bootstrap) : fallback.clinics), [bootstrap, fallback.clinics]);
  return (
    <ClinicTimeZoneProvider timeZone={resolveTimeZone(bootstrap?.clinic.zone ?? fallback.zone)}>
      <AppShell
        model={model}
        clinicName={bootstrap ? clinicLabel(bootstrap.clinic.name) : fallback.clinicName}
        user={{ email, role }}
        swEnabled={swEnabled}
        shellClinic={shellClinic}
        clinics={clinics}
        activeClinicId={activeClinicId}
      >
        {children}
      </AppShell>
    </ClinicTimeZoneProvider>
  );
}
