/** Clinic-zone date formatting for the consult (ADR-016): never the browser's zone. en-IN keeps server and client markup identical. */

/** "21 Nov 2026, 3:42 pm" in the clinic's zone. */
export function signedAtLabel(iso: string, timeZone: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const date = new Intl.DateTimeFormat("en-IN", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(at);
  const time = new Intl.DateTimeFormat("en-IN", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(at);
  return `${date}, ${time}`;
}

/** "21 Nov 2026" in the clinic's zone. */
export function clinicDateLabel(iso: string, timeZone: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(at);
}
