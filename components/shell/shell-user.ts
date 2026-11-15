import type { UserRole } from "@/lib/db/types";

/** The signed-in member as the shell shows it (resolved by the server layout from the session, never the client). */
export interface ShellUser {
  email: string;
  role: UserRole;
}

export const ROLE_LABEL: Record<UserRole, string> = {
  owner: "Owner",
  admin: "Admin",
  doctor: "Doctor",
  receptionist: "Receptionist",
  nurse: "Nurse",
};

/** Two letters for the avatar ("TE" for test@…); "?" when there is nothing to show. */
export function initialsOf(email: string): string {
  const letters = email.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase();
  return letters || "?";
}
