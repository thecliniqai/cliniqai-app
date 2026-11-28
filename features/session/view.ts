import type { SessionBootstrap } from "./bootstrap";

/**
 * The shell's views of the session bootstrap (V2-09e 09E-13). No zod here: the shell imports this on every page, and the allow-list parser
 * (`./bootstrap`) is loaded only by the server and by the client's re-read, so the first-load JS of the dashboard does not grow by a validator.
 */
/** The clinic's name as the shell shows it ("Clinic" for an empty one, as the switcher did). */
export function clinicLabel(name: string | null | undefined): string {
  return name?.trim() || "Clinic";
}

/** The user's clinics for the switcher, ordered by name then id (the order the layout's own read gave). */
export function switcherClinics(bootstrap: Pick<SessionBootstrap, "clinics">): { id: string; name: string }[] {
  return bootstrap.clinics
    .map((c) => ({ id: c.id, name: clinicLabel(c.name) }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
