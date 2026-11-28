import { runCleanups } from "@/lib/pwa/cleanup";
import { TENANT_HEADER, CLINIC_CHANGED_CODE } from "./clinic-header";

/** Thrown by a read the server refused with 409 CLINIC_CHANGED; the data layer never stores it and never retries it. */
export class ClinicChangedError extends Error {
  constructor() {
    super("The clinic changed.");
  }
}

/** The request headers that name the clinic this screen was built for. */
export function clinicHeaders(tenantId: string): Record<string, string> {
  return { [TENANT_HEADER]: tenantId };
}

let handling = false;

/**
 * This tab shows a clinic the session is no longer in: clear the client data layer and the live channel (the cleanup registry, as the
 * switch does) and load Today of the session's clinic by a new document. Runs once per document.
 */
export function onClinicChanged(deps: { runCleanups: () => Promise<void>; assign: (url: string) => void } = {
  runCleanups: () => runCleanups("switch"),
  assign: (url) => window.location.assign(url),
}): void {
  if (handling) return;
  handling = true;
  void deps.runCleanups().finally(() => deps.assign(new URL("/today", window.location.origin).href));
}

/** Test seam: forget that a change was handled. */
export function resetClinicChangedForTests(): void {
  handling = false;
}

/** True when a response is the server's CLINIC_CHANGED refusal (409 with the fixed code); reads a clone, never the caller's body. */
export async function isClinicChanged(response: Response): Promise<boolean> {
  if (response.status !== 409) return false;
  try {
    const body = (await response.clone().json()) as { code?: unknown };
    return body.code === CLINIC_CHANGED_CODE;
  } catch {
    return false;
  }
}
