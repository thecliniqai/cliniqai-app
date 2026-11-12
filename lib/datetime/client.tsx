"use client";

import React, { createContext, useContext } from "react";
import { DEFAULT_CLINIC_TZ, todayInTz } from "./index";

/**
 * The clinic's IANA zone for client components (V2-03 03-05, P1-21). The dashboard layout (a server component) reads
 * `tenants.timezone` and provides it here, so every client component computes "today", date defaults and date
 * navigation in the clinic's zone. The browser's zone is never used. Outside a provider (no current caller) the
 * hook answers the clinic default zone, not the browser's.
 */
const ClinicTimeZoneContext = createContext<string>(DEFAULT_CLINIC_TZ);

export function ClinicTimeZoneProvider({ timeZone, children }: { timeZone: string; children: React.ReactNode }) {
  return <ClinicTimeZoneContext.Provider value={timeZone}>{children}</ClinicTimeZoneContext.Provider>;
}

/** The clinic's zone, as provided by the server layout. */
export function useClinicTimeZone(): string {
  return useContext(ClinicTimeZoneContext);
}

/** The clinic's current date, read at render. */
export function useClinicToday(): string {
  return todayInTz(useClinicTimeZone());
}
