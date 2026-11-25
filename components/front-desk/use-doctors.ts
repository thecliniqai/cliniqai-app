"use client";

import { doctorLabel, useBootstrapDoctors, type DoctorChoice } from "@/lib/session/use-bootstrap";

export { doctorLabel };
export type { DoctorChoice };

/**
 * The clinic's bookable doctors (clinicians only, R-2) for the booking, reschedule and waitlist sheets: `null` while loading, an empty list when the load
 * failed or the clinic has none. V2-09e 09E-13 (R-13): from the session bootstrap the shell holds (a renamed or added doctor arrives with the clinic's
 * `settings` version), so opening a sheet reads nothing.
 */
export function useClinicDoctors(): DoctorChoice[] | null {
  return useBootstrapDoctors();
}
