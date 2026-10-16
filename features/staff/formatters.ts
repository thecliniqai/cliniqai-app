/**
 * Doctor and staff display name resolution utilities.
 * Pure formatting functions safe for both client and server components.
 */

export function formatDoctorDisplayName(
  fullName?: string | null,
  fallbackIndex?: number,
  email?: string | null
): string {
  if (fullName && fullName.trim().length > 0) {
    const trimmed = fullName.trim();
    if (trimmed.toLowerCase().startsWith("dr.") || trimmed.toLowerCase().startsWith("dr ")) {
      return trimmed;
    }
    return `Dr. ${trimmed}`;
  }
  if (email && email.includes("@")) {
    const prefix = email.split("@")[0];
    const capitalized = prefix.charAt(0).toUpperCase() + prefix.slice(1);
    return `Dr. ${capitalized}`;
  }
  return fallbackIndex !== undefined ? `Doctor (${fallbackIndex})` : "Doctor";
}

export function formatStaffDisplayName(
  fullName?: string | null,
  role?: string,
  fallbackIndex?: number
): string {
  if (fullName && fullName.trim().length > 0) {
    const trimmed = fullName.trim();
    if (role === "doctor") {
      return trimmed.toLowerCase().startsWith("dr.") || trimmed.toLowerCase().startsWith("dr ")
        ? trimmed
        : `Dr. ${trimmed}`;
    }
    return trimmed;
  }
  const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : "Staff";
  return fallbackIndex !== undefined ? `${roleLabel} (${fallbackIndex})` : roleLabel;
}
