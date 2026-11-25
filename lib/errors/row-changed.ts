/**
 * The stale-write refusal of the queue and billing commands (V2-09e 09E-07, R-19; migration 000126). A command that was sent with the row version
 * the screen showed answers `CONFLICT` with this reason, and writes nothing, when the row moved on since: another device, another user or the
 * patient's own link changed the visit or its invoice. Isomorphic and dependency-free: the server maps it, the screens recognise it.
 *
 * The text is fixed and carries no data: it never names what changed or who changed it.
 */
export const ROW_CHANGED_REASON = "ROW_CHANGED";

export const ROW_CHANGED_MESSAGE = "This changed on another device. The latest is shown.";

/** True for the refusal of a stale version (an `AppError`, or anything with a `reason`). */
export function isRowChanged(error: { reason?: string } | null | undefined): boolean {
  return error?.reason === ROW_CHANGED_REASON;
}

/**
 * The command argument for the version the screen shows: `{}` when there is none (nothing is compared: the previous behaviour, for the system and
 * API callers), else the one named parameter. A value that is not a non-negative whole number cannot be a version any screen showed: it is sent as -1,
 * which no row has, so the command refuses it as stale and writes nothing (never an exception in the request path, never a silent "no version").
 * The version guards honest clients against a lost update; it is not an access control (the actor, the clinic and the permission are checked first).
 */
export function versionArg(
  name: "p_expected_version" | "p_expected_invoice_version",
  version: number | null | undefined
): Record<string, number> {
  if (version === null || version === undefined) return {};
  return { [name]: Number.isSafeInteger(version) && version >= 0 ? version : -1 };
}
