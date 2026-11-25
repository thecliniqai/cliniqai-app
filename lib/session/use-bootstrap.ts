"use client";

import { createContext, createElement, useCallback, useContext, useEffect, useMemo } from "react";
import { hashKey, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SessionBootstrap } from "@/features/session/bootstrap";
import { clinicHeaders, ClinicChangedError, isClinicChanged, onClinicChanged } from "@/lib/live/clinic-changed";
import { emptyVersions } from "@/lib/live/domains";
import { useLiveCore } from "@/lib/live/provider";
import { queryDomains, queryKeys } from "@/lib/query/keys";

/**
 * The session bootstrap on the client (V2-09e 09E-13, R-13): one query per clinic (`[tenantId, "bootstrap"]`), in memory only, cleared with the rest of the
 * data layer at sign-out, lock and clinic switch (R-14). A full load hydrates it from the layout's own read; after that it is read again (one
 * `GET /api/session/bootstrap`) only when the clinic's `settings` version moves past what it holds (a signal, the heartbeat of a live screen, the check on
 * resume, `online` and rejoin: the live core, R-18), when a settings save on this device has been confirmed, or by a `router.refresh` (the layout hydrates
 * the newer answer). `staleTime: Infinity`: no time-based re-read.
 *
 * Held: the profile, the clinic's name and zone, the role (display and navigation only), the doctor directory, the user's clinics and the Rx print display
 * fields. Never held: fees, billing, the access level, entitlements, permissions and every live list: those are read from the database when used.
 */
class BootstrapReadError extends Error {}

/** One `GET /api/session/bootstrap`; never stored under this clinic's key when the session has moved to another clinic. */
export async function fetchSessionBootstrap(tenantId: string, signal?: AbortSignal): Promise<SessionBootstrap> {
  const response = await fetch("/api/session/bootstrap", { cache: "no-store", credentials: "same-origin", signal, headers: clinicHeaders(tenantId) });
  if (await isClinicChanged(response)) {
    onClinicChanged();
    throw new ClinicChangedError();
  }
  if (!response.ok) throw new BootstrapReadError("The session could not be refreshed.");
  // The allow-list parser (zod) is loaded only when a re-read happens, never in the first-load JS of the shell.
  const { parseSessionBootstrap } = await import("@/features/session/bootstrap");
  const parsed = parseSessionBootstrap(await response.json());
  if (!parsed) throw new BootstrapReadError("The session could not be refreshed.");
  return parsed;
}

export function sessionBootstrapOptions(tenantId: string) {
  return {
    queryKey: queryKeys.bootstrap(tenantId),
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchSessionBootstrap(tenantId, signal),
    // Passive: held by the shell on every page; the channel's join does not ask the server for it (a page that is not a live screen pays no call).
    meta: { live: true, passive: true, domains: queryDomains.bootstrap },
    staleTime: Infinity,
  } as const;
}

const TenantContext = createContext<string | null>(null);

/** The clinic whose bootstrap the shell holds (the session's clinic, resolved by the server layout). */
export function SessionBootstrapScope({ tenantId, children }: { tenantId: string; children: React.ReactNode }) {
  return createElement(TenantContext.Provider, { value: tenantId }, children);
}

/** The session bootstrap of the shell's clinic and whether its read failed with nothing held (outside the shell: nothing, never read). */
function useBootstrapState(): { data: SessionBootstrap | null; failed: boolean } {
  const tenantId = useContext(TenantContext);
  const query = useQuery({ ...sessionBootstrapOptions(tenantId ?? "none"), enabled: tenantId !== null });
  if (tenantId === null) return { data: null, failed: false };
  return { data: query.data ?? null, failed: query.data === undefined && query.isError };
}

/** The session bootstrap of the shell's clinic; null while it is not held (outside the shell, or before the first read answered). */
export function useSessionBootstrap(): SessionBootstrap | null {
  return useBootstrapState().data;
}

/** A doctor a picker offers: the user id a visit stores and the label the select shows. */
export interface DoctorChoice {
  id: string;
  label: string;
}

export const doctorLabel = (name: string, specialty: string | null) => {
  const named = /^dr\.?\s/i.test(name) ? name : `Dr. ${name}`;
  return specialty ? `${named} (${specialty.replace(/_/g, " ")})` : named;
};

/**
 * The clinic's bookable doctors from the bootstrap (09E-13: no call of their own; before, every booking, reschedule, waitlist and walk-in sheet asked
 * `getActiveClinicDoctors` when it opened): null while the bootstrap is not held, an empty list when its read failed.
 */
export function useBootstrapDoctors(): DoctorChoice[] | null {
  const { data, failed } = useBootstrapState();
  return useMemo(() => {
    if (data) return data.doctors.map((d) => ({ id: d.id, label: doctorLabel(d.full_name, d.specialty) }));
    return failed ? [] : null;
  }, [data, failed]);
}

/** After a settings save on this device was confirmed: the bootstrap is read again at once (one GET), whatever the signal does. */
export function useRefreshSessionBootstrap(): () => void {
  const queryClient = useQueryClient();
  const tenantId = useContext(TenantContext);
  return useCallback(() => {
    if (tenantId === null) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap(tenantId), exact: true }, { cancelRefetch: true });
  }, [queryClient, tenantId]);
}

/**
 * Inside the live provider: the bootstrap the page hydrated carries the `settings` version of its own statement, which is its basis until a re-read replaces
 * it (so a check that finds the same version re-reads nothing, and a newer one re-reads it once).
 */
export function BootstrapLiveBasis({ settings }: { settings: number | null }): null {
  const core = useLiveCore();
  const tenantId = useContext(TenantContext);
  useEffect(() => {
    if (!core || tenantId === null || settings === null) return;
    core.setBasis(hashKey(queryKeys.bootstrap(tenantId)), { ...emptyVersions(), settings });
  }, [core, tenantId, settings]);
  return null;
}
